from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image
from typing import Optional
import io, requests, numpy as np

app = FastAPI(title="GEK-X Photo Analyzer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class AnalyzeRequest(BaseModel):
    code: str
    color: str
    side: str = "front"
    image_url: Optional[str] = None  # konfigurator can pass exact URL

class AnalyzeResponse(BaseModel):
    code: str
    color: str
    side: str
    image_width: int
    image_height: int
    body_left: int
    body_right: int
    body_top: int
    body_bottom: int
    body_width_px: int
    body_height_px: int
    threshold_used: str

def build_default_url(code: str, color: str, side: str) -> str:
    suffix = "01" if side == "front" else "02"
    return f"https://b2b.hmz.nl/media/itemvariants/{code}_{color}_{suffix}.jpg"

def find_body_bounds(img_array: np.ndarray, min_cluster: int = 50) -> dict:
    """
    Adaptive bounding box detection for garments on white background.
    Phase 1: color thresholds 240→254, accept if body width > 55%
    Phase 2: edge gradient detection for white-on-white
    Phase 3: fallback to full image
    """
    h, w = img_array.shape[:2]
    
    for threshold in [240, 248, 252, 254]:
        mask = np.any(img_array < threshold, axis=2) if img_array.ndim == 3 else img_array < threshold
        col_density = mask.sum(axis=0)
        row_density = mask.sum(axis=1)
        active_cols = np.where(col_density > min_cluster)[0]
        active_rows = np.where(row_density > min_cluster)[0]
        
        if len(active_cols) == 0 or len(active_rows) == 0:
            continue
        
        body_left = int(active_cols[0])
        body_right = int(active_cols[-1])
        
        if (body_right - body_left) / w * 100 > 55:
            return {
                "body_left": body_left, "body_right": body_right,
                "body_top": int(active_rows[0]), "body_bottom": int(active_rows[-1]),
                "threshold_used": str(threshold),
            }
    
    # Edge gradient fallback
    gray = np.mean(img_array, axis=2) if img_array.ndim == 3 else img_array.astype(float)
    gx = np.abs(np.diff(gray, axis=1))
    gy = np.abs(np.diff(gray, axis=0))
    edge_col = gx.sum(axis=0)
    edge_row = gy.sum(axis=1)
    col_thresh = np.percentile(edge_col, 30)
    row_thresh = np.percentile(edge_row, 30)
    active_cols = np.where(edge_col > col_thresh)[0]
    active_rows = np.where(edge_row > row_thresh)[0]
    
    if len(active_cols) > 0 and len(active_rows) > 0:
        body_left = int(active_cols[0])
        body_right = int(active_cols[-1])
        if (body_right - body_left) / w * 100 > 40:
            return {
                "body_left": body_left, "body_right": body_right,
                "body_top": int(active_rows[0]), "body_bottom": int(active_rows[-1]),
                "threshold_used": "edge",
            }
    
    return {"body_left": 0, "body_right": w, "body_top": 0, "body_bottom": h, "threshold_used": "fallback"}

@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(req: AnalyzeRequest):
    url = req.image_url or build_default_url(req.code, req.color, req.side)
    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
    except requests.exceptions.HTTPError:
        raise HTTPException(status_code=404, detail=f"Image not found: {url}")
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Fetch failed: {str(e)}")
    
    img = Image.open(io.BytesIO(resp.content)).convert("RGB")
    bounds = find_body_bounds(np.array(img))
    
    return AnalyzeResponse(
        code=req.code, color=req.color, side=req.side,
        image_width=img.width, image_height=img.height,
        body_left=bounds["body_left"], body_right=bounds["body_right"],
        body_top=bounds["body_top"], body_bottom=bounds["body_bottom"],
        body_width_px=bounds["body_right"] - bounds["body_left"],
        body_height_px=bounds["body_bottom"] - bounds["body_top"],
        threshold_used=bounds["threshold_used"],
    )

@app.post("/batch")
async def batch_analyze(items: list[AnalyzeRequest]):
    results = []
    for req in items:
        try:
            result = await analyze(req)
            results.append(result.model_dump())
        except HTTPException as e:
            results.append({"code": req.code, "color": req.color, "side": req.side, "error": e.detail})
    return results

@app.get("/health")
async def health():
    return {"status": "ok", "service": "gek-x-photo-analyzer"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
