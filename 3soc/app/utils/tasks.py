from ultralytics import YOLO
from pathlib import Path
import torch
import cv2
from typing import List, Dict, Any
import traceback

# Inference hyperparameters — khớp với script test Python
INFER_IMGSZ = 640
INFER_CONF  = 0.25   # script test dùng 0.25
INFER_IOU   = 0.70   # script test dùng 0.70


# Configure device
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
print(f"[TASKS] DEVICE={DEVICE} (cuda_available={torch.cuda.is_available()})")

# Models to run (3 models)
MODEL_FILES = {
    "co3soc": Path("models/3soc.pt"),
    "duongluoibo": Path("models/duongluoibo.pt"),
    "vnmap": Path("models/vnmap.pt"),
}

# load models
_MODELS = {}
for name, p in MODEL_FILES.items():
    if p.exists():
        try:
            _MODELS[name] = YOLO(str(p))
            print(f"[TASKS] loaded model {name} on {DEVICE}")
        except Exception as e:
            print(f"[TASKS] failed to load {name}: {e}")


def _boxes_from_result(res) -> List[Dict[str, Any]]:
    boxes_out = []
    try:
        boxes = res.boxes
        xyxy = boxes.xyxy.cpu().numpy()  # (N,4)
        confs = boxes.conf.cpu().numpy()
        cls = boxes.cls.cpu().numpy().astype(int)
        for i, b in enumerate(xyxy):
            x1, y1, x2, y2 = [float(x) for x in b]
            boxes_out.append({"x1": x1, "y1": y1, "x2": x2, "y2": y2, "score": float(confs[i]), "class": int(cls[i])})
    except Exception:
        # fallback
        try:
            for box in getattr(res, "boxes", []):
                boxes_out.append({"x1": float(box[0]), "y1": float(box[1]), "x2": float(box[2]), "y2": float(box[3]), "score": float(box[4])})
        except Exception:
            pass
    return boxes_out


def run_detection_on_frame(frame) -> List[Dict[str, Any]]:
    """
    Run all models on a single frame (numpy array) and return list of detections.
    Used for real-time frame processing in video detection.
    """
    aggregate_results = []
    try:
        try:
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        except Exception as e:
            print(f"[TASKS] BGR→RGB convert failed, using original frame: {e}")
            frame_rgb = frame
        for model_name, model in _MODELS.items():
            try:
                res_list = model(frame_rgb, imgsz=INFER_IMGSZ, conf=INFER_CONF, iou=INFER_IOU, half=False, save=False, verbose=False)
                if len(res_list) == 0:
                    continue
                res = res_list[0]
                boxes = _boxes_from_result(res)
                # attach model name to each box
                for b in boxes:
                    b["model"] = model_name
                aggregate_results.extend(boxes)
            except Exception as e:
                print(f"[TASKS] error running model {model_name} on frame: {e}")
    except Exception as e:
        print(f"[TASKS] unexpected error in run_detection_on_frame: {e}")
        traceback.print_exc()
    
    return aggregate_results


def run_detection_on_image_temp(image_path: str) -> List[Dict[str, Any]]:
    """
    Run all models on a temporary image file and return detections immediately.
    No DB save - just return results. Used for quick image detection from API.
    """
    aggregate_results = []
    try:
        img = cv2.imread(str(image_path))
        if img is not None:
            try:
                img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            except Exception as e:
                print(f"[TASKS] BGR→RGB convert failed for image, using original: {e}")
        source = img if img is not None else str(image_path)
        for model_name, model in _MODELS.items():
            try:
                res_list = model(source, imgsz=INFER_IMGSZ, conf=INFER_CONF, iou=INFER_IOU, half=False, save=False, verbose=False)
                if len(res_list) == 0:
                    continue
                res = res_list[0]
                boxes = _boxes_from_result(res)
                # attach model name and label to each box
                for b in boxes:
                    b["model"] = model_name
                    b["label"] = model_name  # Add label for frontend
                aggregate_results.extend(boxes)
            except Exception as e:
                print(f"[TASKS] error running model {model_name}: {e}")
                traceback.print_exc()
    except Exception as e:
        print(f"[TASKS] unexpected error in run_detection_on_image_temp: {e}")
        traceback.print_exc()
    
    return aggregate_results
