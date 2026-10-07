"use client";

import { useEffect, useState } from "react";
import type { VenuePhoto } from "@/lib/photos";

export default function OptionImages({ sources, title }: { sources: { sourceUrl: string; venue: string }[]; title: string }) {
  const sourceKey = JSON.stringify(sources);
  const [photos, setPhotos] = useState<VenuePhoto[]>([]);
  const [failed, setFailed] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState("");

  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setLoading(true); setPhotos([]); setFailed([]); setIndex(0); setLoaded("");
    fetch("/api/photos", { method: "POST", headers: { "Content-Type": "application/json" }, body: sourceKey, signal: controller.signal })
      .then(response => response.ok ? response.json() : { photos: [] })
      .then(data => { if (active) setPhotos(Array.isArray(data.photos) ? data.photos : []); })
      .catch(() => { /* The itinerary remains useful when a publisher blocks images. */ })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [sourceKey]);

  const available = photos.filter(photo => !failed.includes(photo.imageUrl));
  const currentIndex = Math.min(index, Math.max(0, available.length - 1));
  const photo = available[currentIndex];
  const ready = photo && loaded === photo.imageUrl;
  return <figure className="option-visual">
    <div className={`photo-frame ${loading || (photo && !ready) ? "photo-loading" : ""}`}>
      {photo ? <a href={photo.sourceUrl} target="_blank" rel="noopener noreferrer" className="photo-link" aria-label={`View image source for ${photo.venue}`}>
        {/* A bounded same-origin proxy keeps publisher URLs out of image requests. */}
        <img key={photo.imageUrl} src={photo.imageUrl} alt={photo.alt} width={800} height={520} loading="lazy" decoding="async" className={ready ? "is-loaded" : ""} onLoad={event => {
          const image = event.currentTarget;
          if (image.naturalWidth < 300 || image.naturalHeight < 180 || image.naturalWidth / image.naturalHeight > 3.5) { setFailed(current => [...current, photo.imageUrl]); setLoaded(""); }
          else setLoaded(photo.imageUrl);
        }} onError={() => { setFailed(current => [...current, photo.imageUrl]); setLoaded(""); }} />
      </a> : <div className="photo-placeholder" aria-label={loading ? "Finding venue images" : "Venue image unavailable"}>
        <svg width="44" height="44" viewBox="0 0 48 48" fill="none" aria-hidden="true"><rect x="7" y="10" width="34" height="29" rx="4" stroke="currentColor" strokeWidth="1.6" /><circle cx="17" cy="20" r="3" stroke="currentColor" strokeWidth="1.6" /><path d="m8 34 10-8 7 6 7-12 8 12" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
        <span>{loading ? "Finding a little inspiration…" : "A place to discover together"}</span>
      </div>}
      {photo && available.length > 1 && <div className="photo-controls"><button type="button" aria-label={`Previous image for ${title}`} onClick={() => { setIndex((currentIndex - 1 + available.length) % available.length); setLoaded(""); }}>‹</button><span>{currentIndex + 1} / {available.length}</span><button type="button" aria-label={`Next image for ${title}`} onClick={() => { setIndex((currentIndex + 1) % available.length); setLoaded(""); }}>›</button></div>}
    </div>
    <figcaption>{photo ? <a href={photo.sourceUrl} target="_blank" rel="noopener noreferrer" title={`Image published on ${new URL(photo.sourceUrl).hostname}`}><span>{photo.venue}</span><span>Image source ↗</span></a> : <span>{loading ? "From the places in your plan" : "No image available from this venue"}</span>}</figcaption>
  </figure>;
}
