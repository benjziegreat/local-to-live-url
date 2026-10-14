const EARTH_RADIUS_M = 6371000;

/** Great-circle distance in meters between two lat/lng points. */
function distanceMeters(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

function insideGeofence(fence, lat, lng) {
  const distance = distanceMeters(fence.centerLat, fence.centerLng, lat, lng);
  return { inside: distance <= fence.radiusMeters, distance: Math.round(distance) };
}

module.exports = { distanceMeters, insideGeofence };
