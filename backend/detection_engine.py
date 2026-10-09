import time 
from datetime import datetime 
from typing import Dict, List, Tuple 
 
import cv2 
import numpy as np 
import torch 
from ultralytics import YOLO 
 
from backend.ppe_workflow import build_class_map as build_ppe_workflow_map 
 
from backend.config import ( 
    COLOR_HAZARD, 
    COLOR_INFO, 
    COLOR_SAFE, 
    COLOR_WARNING, 
    DEVICE, 
    FIRE_CONFIDENCE, 
    FIRE_SMOKE_MODEL_PATH, 
    IMG_SIZE, 
    PPE_CONFIDENCE, 
    SMOKE_CONFIDENCE, 
) 
 
 
class SafetyComplianceEngine: 
    """Persistent two-model inference engine for SafeScan360. 
 
    best.pt is used only for PPE/person classes and Fire_smoke.pt is used only 
    for fire/smoke classes. Models are loaded once when the FastAPI process starts. 
    """ 
 
    def __init__(self): 
        self.device = self._resolve_device() 
        print(f"[INIT] Device: {self.device}") 
        print(f"[INIT] Loading PPE model: {self._model_path('best.pt')}") 
        self.ppe_model = YOLO(str(self._model_path("best.pt"))) 
        self.ppe_names = self._names(self.ppe_model) 
 
        print(f"[PPE CLASSES] {self.ppe_names}") 
        print(f"[INIT] Loading Fire/Smoke model: {FIRE_SMOKE_MODEL_PATH}") 
        self.hazard_model = YOLO(str(FIRE_SMOKE_MODEL_PATH)) 
        self.hazard_names = self._names(self.hazard_model) 
        print(f"[FIRE/SMOKE CLASSES] {self.hazard_names}") 
 
        self.class_map = self._build_class_map() 
        print(f"[CLASS MAP] {self.class_map}") 

        # Application-level mapping used only by the Face -> PPE -> Work-authorization
        # workflow (derived from the model's real names; class IDs are never assumed).
        self.ppe_app_map = build_ppe_workflow_map(self.ppe_names)
        print(f"[WORKFLOW PPE MAP] {{ {', '.join(f'{i}:{self.ppe_names[i]}->{a}' for i, a in self.ppe_app_map.items())} }}")
 
        # Warm up the models once. This reduces first-request latency. 
        try: 
            dummy = np.zeros((IMG_SIZE, IMG_SIZE, 3), dtype=np.uint8) 
            self.ppe_model(dummy, imgsz=IMG_SIZE, conf=PPE_CONFIDENCE, device=self.device, verbose=False) 
            self.hazard_model(dummy, imgsz=IMG_SIZE, conf=min(FIRE_CONFIDENCE, SMOKE_CONFIDENCE), device=self.device, verbose=False) 
        except Exception as exc: 
            print(f"[WARMUP] skipped: {exc}") 
 
    @staticmethod 
    def _model_path(name: str): 
        from backend.config import BASE_DIR 
        return BASE_DIR / name 
 
    @staticmethod 
    def _resolve_device(): 
        if DEVICE == "cpu": 
            return "cpu" 
        if DEVICE.startswith("cuda"): 
            return DEVICE if torch.cuda.is_available() else "cpu" 
        return "cuda:0" if torch.cuda.is_available() else "cpu" 
 
    @staticmethod 
    def _names(model): 
        names = model.names 
        return dict(names) if isinstance(names, dict) else {i: n for i, n in enumerate(names)} 
 
    @staticmethod 
    def _norm(name) -> str: 
        return str(name).lower().strip().replace("_", "-").replace(" ", "-") 
 
    def _build_class_map(self): 
        normalized = {idx: self._norm(name) for idx, name in self.ppe_names.items()} 
        hazard_normalized = {idx: self._norm(name) for idx, name in self.hazard_names.items()} 
        return { 
            "ppe": normalized, 
            "hazard": hazard_normalized, 
            "person": self._find(normalized, {"person"}), 
            "helmet": self._find(normalized, {"helmet", "hardhat", "hard-hat"}), 
            "vest": self._find(normalized, {"vest", "high-vis", "high-vis-vest", "safety-vest"}), 
            "gloves": self._find(normalized, {"gloves", "glove"}), 
            "boots": self._find(normalized, {"boots", "boot", "shoe", "shoes", "footwear"}), 
            "goggles": self._find(normalized, {"goggles", "goggle", "safety-goggles"}), 
            "no_helmet": self._find(normalized, {"no-helmet"}), 
            "no_vest": self._find(normalized, {"no-vest"}), 
            "no_gloves": self._find(normalized, {"no-gloves", "no-glove"}), 
            "no_boots": self._find(normalized, {"no-boots", "no-boot", "no-shoes", "no-shoe"}), 
            "no_goggles": self._find(normalized, {"no-goggle", "no-goggles"}), 
            "fire": self._find(hazard_normalized, {"fire", "flame", "fire-flame"}), 
            "smoke": self._find(hazard_normalized, {"smoke", "smoke-cloud"}), 
        } 
 
    @staticmethod 
    def _find(mapping: Dict[int, str], candidates: set): 
        for idx, name in mapping.items(): 
            if name in candidates: 
                return idx 
        return None 
 
    @staticmethod 
    def _box(box) -> Tuple[int, int, int, int]: 
        return tuple(int(v) for v in box.xyxy[0].tolist()) 
 
    @staticmethod 
    def _iou(a, b): 
        ax1, ay1, ax2, ay2 = a 
        bx1, by1, bx2, by2 = b 
        ix1, iy1 = max(ax1, bx1), max(ay1, by1) 
        ix2, iy2 = min(ax2, bx2), min(ay2, by2) 
        if ix2 <= ix1 or iy2 <= iy1: 
            return 0.0 
        inter = (ix2 - ix1) * (iy2 - iy1) 
        aa = max(1, (ax2 - ax1) * (ay2 - ay1)) 
        ab = max(1, (bx2 - bx1) * (by2 - by1)) 
        return inter / float(aa + ab - inter) 
 
    @staticmethod 
    def _contains_center(box, zone): 
        x1, y1, x2, y2 = box 
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2 
        zx1, zy1, zx2, zy2 = zone 
        return zx1 <= cx <= zx2 and zy1 <= cy <= zy2 
 
    def _associated(self, detections, zone, min_iou=0.01): 
        return [d for d in detections if self._iou(d["box"], zone) >= min_iou or self._contains_center(d["box"], zone)] 
 
    def _infer(self, model, frame, conf): 
        return model.predict(frame, imgsz=IMG_SIZE, conf=conf, device=self.device, verbose=False)[0] 
 
    def detect_ppe_items(self, frame: np.ndarray, conf: float):
        """Raw PPE detections for the verification workflow (does not draw on `frame`).

        Returns [{"item": app_class, "conf": float, "box": [x1,y1,x2,y2] (0-1), "model_class": str}].
        Only classes that map to helmet/vest/shoes/gloves (or their no_* forms) are returned.
        """
        if frame is None or frame.size == 0:
            raise ValueError("Empty frame")
        result = self._infer(self.ppe_model, frame, conf)
        h, w = frame.shape[:2]
        out = []
        for box in result.boxes:
            cls_id = int(box.cls[0].item())
            app_class = self.ppe_app_map.get(cls_id)
            if not app_class:
                continue
            x1, y1, x2, y2 = self._box(box)
            out.append({
                "item": app_class,
                "conf": float(box.conf[0].item()),
                "box": [max(0.0, x1 / w), max(0.0, y1 / h), min(1.0, x2 / w), min(1.0, y2 / h)],
                "model_class": self.ppe_names.get(cls_id, str(cls_id)),
            })
        return out

    def process_frame(self, frame: np.ndarray): 
        started = time.perf_counter() 
        if frame is None or frame.size == 0: 
            raise ValueError("Empty frame") 
 
        ppe_result = self._infer(self.ppe_model, frame, PPE_CONFIDENCE) 
        hazard_result = self._infer(self.hazard_model, frame, min(FIRE_CONFIDENCE, SMOKE_CONFIDENCE)) 
 
        detections = [] 
        persons, positive, negative = [], [], [] 
 
        positive_keys = {"helmet", "vest", "gloves", "boots", "goggles"} 
        negative_keys = {"no_helmet", "no_vest", "no_gloves", "no_boots", "no_goggles"} 
        id_to_key = {} 
        for key in positive_keys | negative_keys | {"person"}: 
            idx = self.class_map.get(key) 
            if idx is not None: 
                id_to_key[idx] = key 
 
        for box in ppe_result.boxes: 
            cls_id = int(box.cls[0].item()) 
            conf = float(box.conf[0].item()) 
            key = id_to_key.get(cls_id) 
            coords = self._box(box) 
            if not key: 
                continue 
            item = {"box": coords, "conf": conf, "class": key} 
            detections.append(item) 
            if key == "person": 
                persons.append(item) 
            elif key in positive_keys: 
                positive.append(item) 
            elif key in negative_keys: 
                negative.append(item) 
 
        hazards = [] 
        for box in hazard_result.boxes: 
            cls_id = int(box.cls[0].item()) 
            conf = float(box.conf[0].item()) 
            key = "fire" if cls_id == self.class_map.get("fire") else "smoke" if cls_id == self.class_map.get("smoke") else None 
            if not key: 
                continue 
            threshold = FIRE_CONFIDENCE if key == "fire" else SMOKE_CONFIDENCE 
            if conf < threshold: 
                continue 
            hazards.append({"box": self._box(box), "type": key.upper(), "conf": conf}) 
 
        workers = [] 
        events = [] 
        compliant = 0 
        violations = 0 
        h, w = frame.shape[:2] 
 
        positive_by_key = {key: [d for d in positive if d["class"] == key] for key in positive_keys} 
        negative_by_key = { 
            "helmet": [d for d in negative if d["class"] == "no_helmet"], 
            "vest": [d for d in negative if d["class"] == "no_vest"], 
            "gloves": [d for d in negative if d["class"] == "no_gloves"], 
            "boots": [d for d in negative if d["class"] == "no_boots"], 
            "goggles": [d for d in negative if d["class"] == "no_goggles"], 
        } 
 
        for i, person in enumerate(persons, 1): 
            px1, py1, px2, py2 = person["box"] 
            ph = max(1, py2 - py1) 
            zones = { 
                "helmet": (px1 - int(ph * .08), py1 - int(ph * .08), px2 + int(ph * .08), py1 + int(ph * .36)), 
                "goggles": (px1 - int(ph * .08), py1, px2 + int(ph * .08), py1 + int(ph * .32)), 
                "vest": (px1 - int(ph * .10), py1 + int(ph * .18), px2 + int(ph * .10), py1 + int(ph * .72)), 
                "gloves": (px1 - int(ph * .12), py1 + int(ph * .20), px2 + int(ph * .12), py2 - int(ph * .12)), 
                "boots": (px1 - int(ph * .10), py1 + int(ph * .68), px2 + int(ph * .10), py2 + int(ph * .10)), 
            } 
 
            status = {} 
            missing = [] 
            evidence = [] 
            for gear in ["helmet", "vest", "gloves", "boots", "goggles"]: 
                pos = self._associated(positive_by_key[gear], zones[gear], .01) 
                neg = self._associated(negative_by_key[gear], zones[gear], .01) 
                status[gear] = bool(pos) 
                # Only an explicit no_* model detection creates a violation. 
                if neg and not pos: 
                    missing.append(f"No {gear.title()}") 
                    evidence.append(f"no_{gear}") 
 
            is_compliant = not missing 
            if is_compliant: 
                compliant += 1 
            else: 
                violations += 1 
                events.append({ 
                    "type": "PPE_VIOLATION", 
                    "severity": "MEDIUM" if len(missing) == 1 else "HIGH", 
                    "message": f"Worker {i}: {', '.join(missing)}", 
                    "missing": missing, 
                    "worker_id": f"W-{i:03d}", 
                    "timestamp": datetime.now().strftime("%H:%M:%S"), 
                }) 
 
            workers.append({ 
                "worker_id": f"W-{i:03d}", 
                "box": person["box"], 
                "confidence": round(person["conf"], 3), 
                "helmet": status["helmet"], 
                "vest": status["vest"], 
                "gloves": status["gloves"], 
                "boots": status["boots"], 
                "goggles": status["goggles"], 
                "missing": missing, 
                "evidence": evidence, 
                "compliant": is_compliant, 
            }) 
 
        fire_count = sum(hz["type"] == "FIRE" for hz in hazards) 
        smoke_count = sum(hz["type"] == "SMOKE" for hz in hazards) 
        hazard_types = sorted(set(hz["type"] for hz in hazards)) 
 
        for hz in hazards: 
            events.append({ 
                "type": hz["type"], 
                "severity": "CRITICAL" if hz["type"] == "FIRE" else "HIGH", 
                "message": f"{hz['type'].title()} detected", 
                "confidence": round(hz["conf"], 3), 
                "box": hz["box"], 
                "timestamp": datetime.now().strftime("%H:%M:%S"), 
            }) 
 
        # Annotation: workers/PPE first, hazards last so hazards are visible. 
        for d in detections: 
            x1, y1, x2, y2 = d["box"] 
            color = COLOR_INFO 
            label = f"{d['class'].replace('_', ' ').upper()} {d['conf']:.2f}" 
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2) 
            cv2.putText(frame, label, (x1, max(16, y1 - 5)), cv2.FONT_HERSHEY_SIMPLEX, .45, color, 1, cv2.LINE_AA) 
 
        for worker in workers: 
            x1, y1, x2, y2 = worker["box"] 
            color = COLOR_SAFE if worker["compliant"] else COLOR_WARNING 
            label = f"{worker['worker_id']} {'COMPLIANT' if worker['compliant'] else 'VIOLATION'}" 
            if worker["missing"]: 
                label += f": {', '.join(worker['missing'])}" 
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 3) 
            cv2.putText(frame, label[:90], (x1, max(18, y1 - 8)), cv2.FONT_HERSHEY_SIMPLEX, .45, color, 2, cv2.LINE_AA) 
 
        for hz in hazards: 
            x1, y1, x2, y2 = hz["box"] 
            color = COLOR_HAZARD 
            label = f"{hz['type']} {hz['conf']:.2f}" 
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 4) 
            cv2.putText(frame, label, (x1, max(22, y1 - 8)), cv2.FONT_HERSHEY_SIMPLEX, .65, color, 2, cv2.LINE_AA) 
 
        total = len(persons) 
        compliance_pct = round((compliant / total) * 100, 1) if total else 0.0 
        elapsed_ms = (time.perf_counter() - started) * 1000 
        stats = { 
            "total_workers": total, 
            "compliant": compliant, 
            "violations": violations, 
            "hazards": len(hazards), 
            "fire": fire_count > 0, 
            "smoke": smoke_count > 0, 
            "fire_count": fire_count, 
            "smoke_count": smoke_count, 
            "hazard_types": hazard_types, 
            "compliance_pct": f"{compliance_pct:.1f}%" if total else "0%", 
            "workers": workers, 
            "events": events, 
            "processing_ms": round(elapsed_ms, 1), 
            "ppe_detections": [{"class": d["class"], "box": [int(v) for v in d["box"]], "conf": round(d["conf"], 3)} for d in detections if d["class"] != "person"], 
            "fps": round(1000 / elapsed_ms, 1) if elapsed_ms > 0 else 0, 
            "device": self.device, 
            "model_info": { 
                "ppe_model": True, 
                "fire_smoke_model": True, 
                "device": self.device, 
                "ppe_classes": list(self.ppe_names.values()), 
                "fire_smoke_classes": list(self.hazard_names.values()), 
            }, 
        } 
        return frame, stats 
