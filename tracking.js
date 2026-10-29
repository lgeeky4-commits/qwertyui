// Temporary session tracking IDs; these are not face identities or biometric recognition.
export class TrackManager {
  constructor(prefix, ttlMs = 900) {
    this.prefix = prefix;
    this.ttlMs = ttlMs;
    this.nextId = 1;
    this.tracks = [];
  }
  clear() { this.tracks = []; this.nextId = 1; }
  prune(now) { this.tracks = this.tracks.filter(track => now - track.lastSeen <= this.ttlMs); }
  active(now, maxAge = 650) { return this.tracks.filter(track => now - track.lastSeen <= maxAge); }
  ingest(boxes, now, frameWidth, frameHeight) {
    this.prune(now);
    const newTracks = [];
    const taken = new Set();
    const diagonal = Math.hypot(frameWidth, frameHeight) || 1;
    for (const box of boxes) {
      if (!(box.w > 0 && box.h > 0)) continue;
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      let candidate = null, bestScore = Infinity;
      for (const track of this.tracks) {
        if (taken.has(track.id)) continue;
        const tcx = track.x + track.w / 2;
        const tcy = track.y + track.h / 2;
        const distance = Math.hypot(cx - tcx, cy - tcy) / diagonal;
        // Account for object size: two nearby but distant targets should not swap IDs.
        const tolerance = Math.max(.055, Math.min(.24, (Math.max(box.w, box.h, track.w, track.h) / diagonal) * 1.7));
        if (distance > tolerance) continue;
        const sizeChange = Math.abs(Math.log((box.w * box.h + 1) / (track.w * track.h + 1)));
        const score = distance + sizeChange * .025;
        if (score < bestScore) { bestScore = score; candidate = track; }
      }
      if (candidate) {
        const previous = {x:candidate.x + candidate.w/2, y:candidate.y + candidate.h/2};
        candidate.x = box.x; candidate.y = box.y; candidate.w = box.w; candidate.h = box.h;
        candidate.confidence = box.confidence ?? null;
        candidate.keypoints = box.keypoints || [];
        candidate.lastSeen = now;
        candidate.seenCount++;
        if (Math.hypot(previous.x - cx, previous.y - cy) > 2) {
          candidate.trail.push({x:cx,y:cy,at:now});
          candidate.trail = candidate.trail.filter(p=> now-p.at < 2400).slice(-26);
        }
        taken.add(candidate.id);
      } else {
        const id = `${this.prefix}-${String(this.nextId++).padStart(3,'0')}`;
        const created = {id,x:box.x,y:box.y,w:box.w,h:box.h,confidence:box.confidence??null,keypoints:box.keypoints||[],lastSeen:now,createdAt:now,seenCount:1,trail:[{x:cx,y:cy,at:now}]};
        this.tracks.push(created);
        newTracks.push(created);
        taken.add(id);
      }
    }
    return newTracks;
  }
}
