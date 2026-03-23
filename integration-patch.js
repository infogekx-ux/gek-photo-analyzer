// =============================================
// PATCH: Drop this into the konfigurator
// Replaces getPhotoZone() with analyzer-aware version
// =============================================
// 1. Add these variables at the top (after S = {} state):

const SUPA_URL = 'https://dkihhmphimfqhyuzajwc.supabase.co';
const SUPA_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRraWhobXBoaW1mcWh5dXphandjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1MzI0NzQsImV4cCI6MjA4NzEwODQ3NH0.ky8a6mcPzlRKZyit6JbuyCJ2ZA7KnH6h2mmzpzNmjsw';
const pzCache = {}; // session cache: "LEM3350_BK_front" → pz object

// 2. Replace getPhotoZone() with this:

function getPhotoZone(){
  // Try analyzer data first (pre-fetched in loadPhotoZone)
  const code = S.prod?.code;
  const color = S.col || S.prod?.colors?.[0]?.code || 'BK';
  const side = S.gside || 'front';
  const key = `${code}_${color}_${side}`;
  
  if (pzCache[key]) return pzCache[key];
  
  // Fallback: hardcoded PHOTO_ZONES
  const type = getGarmentType();
  const z = PHOTO_ZONES[type] || PHOTO_ZONES.tshirt;
  return side === 'front' ? z.front : z.back;
}

// 3. Add this function (fetches from Supabase, converts to pz format):

async function loadPhotoZone(code, colorCode, side) {
  const key = `${code}_${colorCode}_${side}`;
  if (pzCache[key]) return; // already cached
  
  try {
    const resp = await fetch(
      `${SUPA_URL}/rest/v1/product_photo_zones?code=eq.${code}&color_code=eq.${colorCode}&side=eq.${side}&limit=1`,
      { headers: { 'apikey': SUPA_ANON, 'Authorization': `Bearer ${SUPA_ANON}` } }
    );
    const rows = await resp.json();
    if (!rows.length) return;
    
    const d = rows[0];
    // Convert analyzer pixels → percentage format matching PHOTO_ZONES
    pzCache[key] = {
      cx: (d.body_left + d.body_width_px / 2) / d.image_width * 100,
      ty: d.body_top / d.image_height * 100,
      bw: d.body_width_px / d.image_width * 100,
      bh: d.body_height_px / d.image_height * 100
    };
    
    // Re-position graphic with accurate data
    if (S.gfx) positionGfx();
  } catch(e) {
    console.warn('Photo zone fetch failed:', e);
  }
}

// 4. Add this call in renderGarment() — after loadProductImg line:
//    loadPhotoZone(S.prod.code, cc, side==='front'?'front':'back');
//    (fire & forget — async, re-positions when data arrives)
