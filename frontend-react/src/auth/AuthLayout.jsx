import React from "react";
import { Link } from "react-router-dom";

import logo from "../assets/ppe-logo.png";
import img from "../assets/image.png";


export default function AuthLayout({
  title,
  subtitle,
  children,
}) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-900 lg:grid lg:grid-cols-[1.15fr_0.85fr]">


      <aside className="relative hidden min-h-screen overflow-hidden bg-slate-950 lg:block">

{/* background img show  */}
        <img src={img} alt="SafeScan 360 Industrial Safety" className="absolute inset-0 h-full w-full object-cover"/>
            <div className="absolute inset-0 bg-gradient-to-br from-slate-950/95 via-slate-950/65 to-blue-950/70" />
              <div className="absolute -left-32 top-1/4 h-96 w-96 rounded-full bg-blue-600/20 blur-3xl" />

        <div className="absolute -right-20 bottom-10 h-80 w-80 rounded-full bg-cyan-500/20 blur-3xl" />

        <div className="absolute inset-0 opacity-10" style={{ backgroundImage:
              "linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)",
            backgroundSize: "45px 45px",
          }}
        />

        {/* Content */}
        <div className="relative z-10 flex min-h-screen flex-col justify-between p-10 xl:p-14">

          <Link
            to="/welcome"
            className="group flex w-fit items-center gap-4">


            <div className="flex h-14 w-14 items-center justify-center rounded-2xl   p-2 shadow-2xl backdrop-blur-xl transition group-hover:scale-105">
              <img src={logo} alt="SafeScan 360" className="h-full w-full object-contain"/>
            </div>

            <div>
              <div className="text-xl font-black tracking-tight text-white">
                SafeScan
                <span className="text-blue-400">360</span>
              </div>

              <div className="text-[10px] font-bold  tracking-[0.25em] text-slate-400">
                AI Industrial Safety Platform
              </div>
            </div>

          </Link>

          <div className="max-w-2xl">


            {/* Heading */}
            <h2 className="text-5xl font-black leading-[1.05] tracking-tight text-white xl:text-6xl">Your Safety <br />

              <span className="bg-gradient-to-r from-blue-400 via-cyan-300 to-blue-500 bg-clip-text text-transparent">
       Our             Intelligence.
              </span> </h2>


            {/* Description */}
            <p className="mt-7 max-w-xl text-base leading-7 text-slate-300">
              Intelligent workplace safety powered by computer vision.
              Detect PPE violations, identify hazards and protect your
              workforce in real time.
            </p>

          </div>


          <div className="flex items-center justify-between border-t border-white/10 pt-6">
              </div>

        </div>

      </aside>


      <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-50 px-5 py-10 sm:px-10">


        <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-blue-100/60 blur-3xl" />

        <div className="pointer-events-none absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-cyan-100/50 blur-3xl" />

        <div className="relative z-10 w-full max-w-md">

          <Link
            to="/welcome"
            className="mb-10 flex items-center gap-3 lg:hidden">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-950 p-1.5 shadow-lg">
              <img src={logo} alt="SafeScan 360" className="h-full w-full object-contain"/>
            </div>

            <div>

              <div className="text-lg font-black">
                SafeScan
                <span className="text-blue-600">360</span>
              </div>

              <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                AI Safety Platform
              </div>

            </div>

          </Link>

          <div className="mb-8">

            <h1 className="text-4xl font-black tracking-tight text-slate-950">
              {title}
            </h1>

            {subtitle && (
              <p className="mt-3 text-sm leading-6 text-slate-500">
                {subtitle}
              </p>
            )}

          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)] sm:p-8">

            {children}

          </div>


          {/* Security message */}


        </div>

      </main>

    </div>
  );
}

export function Field({
  id,
  label,
  error,
  hint,
  children,
}) {
  return (
    <div>

      <label
        htmlFor={id}
        className="block text-[11px] font-black uppercase tracking-widest text-slate-500"
      >
        {label}
      </label>

      <div className="mt-2">
        {children}
      </div>

      {error ? (
        <p
          id={`${id}-error`}
          className="mt-1.5 text-xs font-semibold text-rose-600"
        >
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-[11px] text-slate-400">
          {hint}
        </p>
      ) : null}

    </div>
  );
}



export const inputClass = (error) =>
  `w-full rounded-xl border bg-slate-50 px-4 py-3.5 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:bg-white focus:ring-4 ${
    error
      ? "border-rose-400 focus:border-rose-500 focus:ring-rose-100"
      : "border-slate-200 focus:border-blue-500 focus:ring-blue-100"
  }`;
