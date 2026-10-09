"""HTTP side of Sign Up / Sign In (NEW module, additive).

* ``router``          -> /api/auth/signup, /signin, /logout, /me
* ``AuthMiddleware``  -> blocks EVERY other endpoint (detection, live stream, uploads, workers,
                         alerts, incidents ...) unless the request carries a valid session cookie.

The middleware is a plain ASGI middleware (not ``BaseHTTPMiddleware``) on purpose: the live camera
endpoints are endless MJPEG streams and must be passed through untouched, with no buffering.
"""
from __future__ import annotations

from http.cookies import SimpleCookie
from typing import Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse

from backend.auth import SESSION_COOKIE, AuthError, AuthStore

# Reachable without logging in. Everything else requires a session.
PUBLIC_PREFIXES = ("/api/auth/",)
PUBLIC_PATHS = {"/api/health"}


def error_response(status: int, code: str, message: str, fields: Optional[dict] = None) -> JSONResponse:
    # Same {"detail": {"code", "message"}} shape the rest of the API already uses.
    detail = {"code": code, "message": message}
    if fields:
        detail["fields"] = fields
    return JSONResponse(status_code=status, content={"detail": detail})


def _token_from_scope(scope) -> Optional[str]:
    for name, value in scope.get("headers", []):
        if name == b"cookie":
            jar = SimpleCookie()
            try:
                jar.load(value.decode("latin-1"))
            except Exception:  # malformed cookie header -> treat as logged out
                return None
            morsel = jar.get(SESSION_COOKIE)
            return morsel.value if morsel else None
    return None


class AuthMiddleware:
    """Reject unauthenticated requests with 401 before they reach any existing route."""

    def __init__(self, app, store: AuthStore):
        self.app = app
        self.store = store

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)

        path = scope.get("path", "")
        is_public = (
            scope["type"] == "http" and scope.get("method") == "OPTIONS"        # CORS pre-flight
            or path in PUBLIC_PATHS
            or path.startswith(PUBLIC_PREFIXES)
        )
        if is_public:
            return await self.app(scope, receive, send)

        user = await run_in_threadpool(self.store.user_for_token, _token_from_scope(scope))
        if user is None:
            if scope["type"] == "websocket":
                return await send({"type": "websocket.close", "code": 1008})
            response = error_response(401, "AUTH_REQUIRED", "Please sign in to continue.")
            return await response(scope, receive, send)

        scope.setdefault("state", {})["user"] = user
        return await self.app(scope, receive, send)


# --------------------------------------------------------------------------- routes
class SignUpBody(BaseModel):
    # Defaults of "" so a missing field becomes a friendly validation message, not a raw 422.
    name: str = ""
    email: str = ""
    mobile: str = ""
    password: str = ""
    confirm_password: str = ""


class SignInBody(BaseModel):
    email: str = ""
    password: str = ""


def build_router(store: AuthStore, session_ttl: float) -> APIRouter:
    router = APIRouter(prefix="/api/auth", tags=["auth"])

    def _fail(exc: AuthError) -> JSONResponse:
        code = {401: "INVALID_CREDENTIALS", 409: "EMAIL_EXISTS", 429: "TOO_MANY_ATTEMPTS"}.get(exc.status, "VALIDATION_ERROR")
        return error_response(exc.status, code, exc.message, exc.fields)

    @router.post("/signup", status_code=201)
    def signup(body: SignUpBody):
        try:
            user = store.create_user(body.name, body.email, body.mobile, body.password, body.confirm_password)
        except AuthError as exc:
            return _fail(exc)
        # Registration does not log the user in: they are asked to sign in (as specified).
        return {"message": "Account created successfully. Please sign in.", "user": user}

    @router.post("/signin")
    def signin(body: SignInBody, request: Request):
        try:
            user = store.authenticate(body.email, body.password)
        except AuthError as exc:
            return _fail(exc)
        token, ttl = store.create_session(user["id"])
        response = JSONResponse({"message": "Signed in.", "user": user})
        response.set_cookie(
            SESSION_COOKIE, token, max_age=int(ttl), httponly=True, samesite="lax",
            secure=request.url.scheme == "https", path="/",
        )
        return response

    @router.post("/logout")
    def logout(request: Request):
        store.delete_session(request.cookies.get(SESSION_COOKIE))
        response = JSONResponse({"message": "Signed out."})
        response.delete_cookie(SESSION_COOKIE, path="/")
        return response

    @router.get("/me")
    def me(request: Request):
        user = store.user_for_token(request.cookies.get(SESSION_COOKIE))
        if user is None:
            return error_response(401, "AUTH_REQUIRED", "Not signed in.")
        return {"user": user}

    return router
