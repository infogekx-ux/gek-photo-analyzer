from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image
from typing import Optional
import io, requests

app = FastAPI(title="GEK-X Photo Analyzer")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

class AnalyzeRequest(BaseModel):
    code: str
    color: str
    side: str = "front"
    image_url: Optional[str] = None

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

def build_default_url(code, color, side):
    suffix = "01" if side == "front" else "02"
    return f"https://b2b.hmz.nl/media/itemvariants/{code}_{color}_{suffix}.jpg"

def find_body_bounds(img, min_cluster=50):
    w, h = img.size
    pixels = img.load()

    for threshold in [240, 248, 252, 254]:
        col_count = [0] * w
        row_count = [0] * h
        for y in range(h):
            for x in range(w):
                r, g, b = pixels[x, y][:3]
                if r < threshold or g < threshold or b < threshold:
                    col_count[x] += 1
                    row_count[y] += 1

        active_cols = [x for x in range(w) if col_count[x] > min_cluster]
        active_rows = [y for y in range(h) if row_count[y] > min_cluster]

        if not active_cols or not active_rows:
            continue

        bl, br = active_cols[0], active_cols[-1]
        if (br - bl) / w * 100 > 55:
            return {
                "body_left": bl, "body_right": br,
                "body_top": active_rows[0], "body_bottom": active_rows[-1],
                "threshold_used": str(threshold),
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
        raise HTTPException(status_code=502, detail=str(e))

    img = Image.open(io.BytesIO(resp.content)).convert("RGB")
    bounds = find_body_bounds(img)

    return AnalyzeResponse(
        code=req.code, color=req.color, side=req.side,
        image_width=img.width, image_height=img.height,
        body_left=bounds["body_left"], body_right=bounds["body_right"],
        body_top=bounds["body_top"], body_bottom=bounds["body_bottom"],
        body_width_px=bounds["body_right"] - bounds["body_left"],
        body_height_px=bounds["body_bottom"] - bounds["body_top"],
        threshold_used=bounds["threshold_used"],
    )

@app.get("/health")
async def health():
    return {"status": "ok", "service": "gek-x-photo-analyzer"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
