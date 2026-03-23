// ============================================
// PHOTO ANALYZER INTEGRATION for Konfigurator
// ============================================
// Drop this into the konfigurator JS section
// Replaces hardcoded PHOTO_ZONES with real measurements
//
// RAILWAY_URL = endpoint po deployu (np. https://gek-x-photo-analyzer.up.railway.app)
// SUPABASE_URL + SUPABASE_ANON = already in konfigurator

const ANALYZER_URL = ''; // ← Railway URL po deployu
const SUPABASE_URL = 'https://dkihhmphimfqhyuzajwc.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRraWhobXBoaW1mcWh5dXphandjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1MzI0NzQsImV4cCI6MjA4NzEwODQ3NH0.ky8a6mcPzlRKZyit6JbuyCJ2ZA7KnH6h2mmzpzNmjsw';

// Cache: already analyzed photos in this session (avoids double fetches)
const photoZoneCache = {};

/**
 * Get photo zone data for a product+color+side combination.
 * 1. Check session cache
 * 2. Check Supabase cache
 * 3. Call Railway analyzer → save to Supabase
 * 4. Return data or null
 */
async function getPhotoZone(code, colorCode, side = 'front') {
    const key = `${code}_${colorCode}_${side}`;
    
    // 1. Session cache
    if (photoZoneCache[key]) return photoZoneCache[key];
    
    // 2. Supabase cache
    try {
        const resp = await fetch(
            `${SUPABASE_URL}/rest/v1/product_photo_zones?code=eq.${code}&color_code=eq.${colorCode}&side=eq.${side}&limit=1`,
            { headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}` } }
        );
        const rows = await resp.json();
        if (rows.length > 0) {
            photoZoneCache[key] = rows[0];
            return rows[0];
        }
    } catch (e) {
        console.warn('Supabase cache miss:', e);
    }
    
    // 3. Analyze via Railway (if URL configured)
    if (!ANALYZER_URL) return null;
    
    try {
        // Build the image URL the same way the konfigurator does
        const imageUrl = imgUrl(code, colorCode); // existing function
        
        const resp = await fetch(`${ANALYZER_URL}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code: code,
                color: colorCode,
                side: side,
                image_url: imageUrl
            })
        });
        
        if (!resp.ok) return null;
        const data = await resp.json();
        
        // Save to Supabase cache (fire & forget)
        fetch(`${SUPABASE_URL}/rest/v1/product_photo_zones`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_ANON,
                'Authorization': `Bearer ${SUPABASE_ANON}`,
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify({
                code: data.code,
                color_code: data.color,
                side: data.side,
                image_width: data.image_width,
                image_height: data.image_height,
                body_left: data.body_left,
                body_right: data.body_right,
                body_top: data.body_top,
                body_bottom: data.body_bottom,
                body_width_px: data.body_width_px,
                body_height_px: data.body_height_px,
                threshold_used: data.threshold_used
            })
        }).catch(() => {}); // silent fail on cache write
        
        photoZoneCache[key] = data;
        return data;
    } catch (e) {
        console.warn('Analyzer failed:', e);
        return null;
    }
}

/**
 * Updated positionGfx — replaces hardcoded PHOTO_ZONES with real data.
 * Falls back to PHOTO_ZONES if analyzer data not available.
 * 
 * Call this instead of the original positionGfx() or patch it in.
 */
async function positionGfxAccurate(gfxEl, areaEl, sizeName, prodCode, colorCode, side, placementPct) {
    const photoData = await getPhotoZone(prodCode, colorCode, side);
    const areaWidth = areaEl.offsetWidth;
    const areaHeight = areaEl.offsetHeight;
    
    let bodyPxOnScreen, bodyStartX, bodyStartY;
    
    if (photoData && photoData.body_width_px) {
        // ACCURATE: use real measurements
        const scaleFactor = areaWidth / photoData.image_width;
        bodyPxOnScreen = photoData.body_width_px * scaleFactor;
        bodyStartX = photoData.body_left * scaleFactor;
        bodyStartY = photoData.body_top * scaleFactor;
    } else {
        // FALLBACK: use hardcoded PHOTO_ZONES
        const type = S.prod?.type || 't-shirt';
        const zone = PHOTO_ZONES[type] || PHOTO_ZONES['t-shirt'];
        bodyPxOnScreen = areaWidth * (zone.bw / 100);
        bodyStartX = areaWidth * (zone.bx / 100);
        bodyStartY = areaHeight * (zone.by / 100);
    }
    
    // Get garment physical width for this size
    const dims = SIZE_DIMS[sizeName];
    if (!dims) return;
    
    const pxPerCm = bodyPxOnScreen / dims.w;
    
    // ... rest of positioning logic stays the same
    // gfxWidthCm, gfxHeightCm → multiply by pxPerCm → set style
}
