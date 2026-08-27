import { PanelExtensionContext, Time } from "@foxglove/extension";
import { ReactElement, useEffect, useLayoutEffect, useState, useRef, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { MapContainer, TileLayer, Polygon, Polyline, CircleMarker, Tooltip, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import distance from "@turf/distance";
import { point, polygon as turfPolygon } from "@turf/helpers";

interface TrajPoint {
  lat: number;
  lng: number;
  time: Time;
  timeSec: number;
}

interface ZoneStats {
  entryPt: TrajPoint;
  exitPt: TrajPoint;
  durationSec: number;
  distanceMeters: number;
  avgSpeedMps: number;
}

type PanelState = {
  polygonPoints?: [number, number][];
  gpsTopic?: string;
  mapCenter?: [number, number];
  mapZoom?: number;
};

function MapInteractionHandler({ 
  onMapClick, 
  onMapUpdate 
}: { 
  onMapClick: (pt: [number, number]) => void;
  onMapUpdate: (center: [number, number], zoom: number) => void;
}) {
  useMapEvents({
    click(e) {
      onMapClick([e.latlng.lat, e.latlng.lng]);
    },
    moveend(e) {
      const map = e.target;
      onMapUpdate([map.getCenter().lat, map.getCenter().lng], map.getZoom());
    },
    zoomend(e) {
      const map = e.target;
      onMapUpdate([map.getCenter().lat, map.getCenter().lng], map.getZoom());
    }
  });
  return null;
}

function GeofenceAnalyzer({ context }: { context: PanelExtensionContext }): ReactElement {
  const [renderDone, setRenderDone] = useState<(() => void) | undefined>();
  const [mapRef, setMapRef] = useState<any>(null);
  
  // Initialize state from Foxglove's persistent layout state
  const [polygonPoints, setPolygonPoints] = useState<[number, number][]>(() => {
    return (context.initialState as PanelState)?.polygonPoints ?? [];
  });
  
  const [gpsTopic, setGpsTopic] = useState<string>(() => {
    return (context.initialState as PanelState)?.gpsTopic ?? "/gps";
  });

  const [mapCenter, setMapCenter] = useState<[number, number]>(() => {
    return (context.initialState as PanelState)?.mapCenter ?? [42.3601, -71.0589];
  });

  const [mapZoom, setMapZoom] = useState<number>(() => {
    return (context.initialState as PanelState)?.mapZoom ?? 13;
  });
  
  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  // Save state back to Foxglove whenever it changes
  useEffect(() => {
    context.saveState({ polygonPoints, gpsTopic, mapCenter, mapZoom });
  }, [polygonPoints, gpsTopic, mapCenter, mapZoom, context]);

  const [trajectory, setTrajectory] = useState<TrajPoint[]>([]);
  const [currentTimeSec, setCurrentTimeSec] = useState<number | null>(null);
  
  // Analysis state
  const [zoneStats, setZoneStats] = useState<ZoneStats[]>([]);
  const [hasChecked, setHasChecked] = useState(false);
  
  const gpsTopicRef = useRef(gpsTopic);

  // Clear analysis if polygon or trajectory changes
  useEffect(() => {
    setZoneStats([]);
    setHasChecked(false);
  }, [polygonPoints, trajectory]);

  useEffect(() => {
    gpsTopicRef.current = gpsTopic;
    context.subscribe([{ topic: gpsTopic, preload: true }]);
  }, [gpsTopic, context]);

  useLayoutEffect(() => {
    context.onRender = (renderState, done) => {
      setRenderDone(() => done);
      
      if (renderState.allFrames && renderState.allFrames.length > 0) {
        const newPoints: TrajPoint[] = [];
        
        for (const msg of renderState.allFrames) {
          if (msg.topic === gpsTopicRef.current && msg.message) {
            const data = msg.message as any;
            if (typeof data.latitude === 'number' && typeof data.longitude === 'number' && msg.receiveTime) {
              const timeSec = msg.receiveTime.sec + msg.receiveTime.nsec / 1e9;
              newPoints.push({
                lat: data.latitude,
                lng: data.longitude,
                time: msg.receiveTime,
                timeSec
              });
            }
          }
        }
        
        if (newPoints.length > 0) {
          newPoints.sort((a, b) => a.timeSec - b.timeSec);
          // Only update state if length changed to prevent infinite re-renders
          setTrajectory(prev => (prev.length === newPoints.length ? prev : newPoints));
        }
      }
      
      if (renderState.currentTime) {
        setCurrentTimeSec(renderState.currentTime.sec + renderState.currentTime.nsec / 1e9);
      }
    };
    
    context.watch("topics");
    context.watch("allFrames");
    context.watch("currentTime");
    context.subscribe([{ topic: gpsTopicRef.current, preload: true }]);
  }, [context]);

  const currentPos = useMemo(() => {
    if (!currentTimeSec || trajectory.length === 0) return null;
    let low = 0;
    let high = trajectory.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const midPt = trajectory[mid];
      if (!midPt) break;
      if (midPt.timeSec < currentTimeSec) {
        low = mid + 1;
      } else if (midPt.timeSec > currentTimeSec) {
        high = mid - 1;
      } else {
        return midPt;
      }
    }
    const p1 = trajectory[Math.max(0, high)];
    const p2 = trajectory[Math.min(trajectory.length - 1, low)];
    if (!p1 || !p2) return null;
    return Math.abs(p1.timeSec - currentTimeSec) < Math.abs(p2.timeSec - currentTimeSec) ? p1 : p2;
  }, [currentTimeSec, trajectory]);

  useEffect(() => {
    renderDone?.();
  }, [renderDone]);

  const handleCitySearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery)}&format=json&limit=1`);
      const data = await res.json();
      if (data && data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);
        if (mapRef) {
          mapRef.flyTo([lat, lon], 12);
        }
      } else {
        alert("Location not found. Please try a different name.");
      }
    } catch (e) {
      console.error("Geocoding error:", e);
      alert("Search failed due to network error.");
    }
    setIsSearching(false);
  };

  const handleAnalyzeZone = () => {
    if (polygonPoints.length < 3 || trajectory.length === 0) {
      setHasChecked(true);
      setZoneStats([]);
      return;
    }

    try {
      const ring = polygonPoints.map(p => [p[1], p[0]]);
      if (ring[0]) { ring.push([...ring[0]]); }
      
      const poly = turfPolygon([ring]);
      
      const allStats: ZoneStats[] = [];
      let inside = false;
      let entryPt: TrajPoint | null = null;
      let exitPt: TrajPoint | null = null;
      let lastInsidePt: TrajPoint | null = null;
      let distanceMeters = 0;
      
      for (const pt of trajectory) {
        const tPt = point([pt.lng, pt.lat]);
        const isInside = booleanPointInPolygon(tPt, poly);

        if (isInside) {
          if (!inside) {
            entryPt = pt;
            inside = true;
            distanceMeters = 0; // Reset for new visit
          } else if (lastInsidePt) {
            distanceMeters += distance(
              point([lastInsidePt.lng, lastInsidePt.lat]), 
              point([pt.lng, pt.lat]), 
              { units: 'meters' }
            );
          }
          lastInsidePt = pt;
        } else {
          if (inside) {
            // Just exited
            exitPt = pt;
            inside = false;
            
            if (entryPt && exitPt && entryPt !== exitPt) {
              const durationSec = exitPt.timeSec - entryPt.timeSec;
              const avgSpeedMps = durationSec > 0 ? distanceMeters / durationSec : 0;
              allStats.push({ entryPt, exitPt, durationSec, distanceMeters, avgSpeedMps });
            }
            
            entryPt = null;
            exitPt = null;
            lastInsidePt = null;
          }
        }
      }

      // Handle case where recording ends while still inside the zone
      if (inside && entryPt && lastInsidePt && entryPt !== lastInsidePt) {
        exitPt = lastInsidePt;
        const durationSec = exitPt.timeSec - entryPt.timeSec;
        const avgSpeedMps = durationSec > 0 ? distanceMeters / durationSec : 0;
        allStats.push({ entryPt, exitPt, durationSec, distanceMeters, avgSpeedMps });
      }

      setZoneStats(allStats);
    } catch (err) {
      console.error("Turf intersection error:", err);
      setZoneStats([]);
    }
    
    setHasChecked(true);
  };

  const handleClearTrajectory = () => {
    setTrajectory([]);
  };

  const handleClearPolygon = () => {
    setPolygonPoints([]);
  };

  const polylinePositions = trajectory.map(p => [p.lat, p.lng] as [number, number]);

  return (
    <div style={{ display: "flex", height: "100%", width: "100%" }}>
      <div style={{ 
        width: "320px", 
        padding: "16px", 
        display: "flex", 
        flexDirection: "column", 
        gap: "16px", 
        borderRight: "1px solid #ccc", 
        background: "#f8f9fa", 
        zIndex: 10,
        boxSizing: "border-box",
        overflowY: "auto"
      }}>
        
        <div>
          <label style={{ display: "block", marginBottom: "4px", fontSize: "14px", fontWeight: "bold" }}>
            City / Location Search:
          </label>
          <div style={{ display: "flex", gap: "8px" }}>
            <input 
              type="text" 
              value={searchQuery} 
              onChange={(e) => setSearchQuery(e.target.value)} 
              onKeyDown={(e) => e.key === 'Enter' && handleCitySearch()}
              style={{ flex: 1, padding: "6px", boxSizing: "border-box" }} 
              placeholder="e.g. San Francisco"
            />
            <button 
              onClick={handleCitySearch}
              disabled={isSearching}
              style={{ padding: "6px 12px", background: "#e9ecef", border: "1px solid #ccc", borderRadius: "4px", cursor: "pointer" }}
            >
              Go
            </button>
          </div>
        </div>
        
        <div>
          <label style={{ display: "block", marginBottom: "4px", fontSize: "14px", fontWeight: "bold" }}>
            GPS Topic Name:
          </label>
          <input 
            type="text" 
            value={gpsTopic} 
            onChange={(e) => {
              setGpsTopic(e.target.value);
              handleClearTrajectory();
            }} 
            style={{ width: "100%", padding: "6px", boxSizing: "border-box" }} 
            placeholder="/gps"
          />
        </div>
        
        <button 
          style={{
            padding: "12px",
            background: "#007bff",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontWeight: "bold",
            fontSize: "14px"
          }}
          onClick={handleAnalyzeZone}
        >
          Analyze Zone
        </button>

        {hasChecked && (
          <div style={{
            padding: "16px",
            background: zoneStats.length > 0 ? "#d4edda" : "#f8d7da",
            border: `2px solid ${zoneStats.length > 0 ? "#28a745" : "#dc3545"}`,
            borderRadius: "8px",
            textAlign: "center",
            color: zoneStats.length > 0 ? "#155724" : "#721c24",
            transition: "all 0.3s ease",
            maxHeight: "350px",
            overflowY: "auto"
          }}>
            {zoneStats.length > 0 ? (
              <div>
                <strong style={{ fontSize: "16px" }}>{zoneStats.length} Zone {zoneStats.length === 1 ? "Visit" : "Visits"} Detected!</strong>
                <hr style={{ borderColor: "#28a745", margin: "8px 0" }} />
                
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {zoneStats.map((stat, idx) => (
                    <div key={idx} style={{ textAlign: "left", background: "rgba(255,255,255,0.5)", padding: "8px", borderRadius: "4px" }}>
                      <strong>Visit #{idx + 1}</strong>
                      <div style={{ fontSize: "13px", marginTop: "4px" }}>
                        <div>
                          <strong>Entry:</strong> 
                          <span 
                            style={{ color: "#007bff", textDecoration: "underline", cursor: "pointer", marginLeft: "4px" }}
                            onClick={() => context.seekPlayback?.(stat.entryPt.time)}
                            title="Click to jump to this timestamp"
                          >
                            {stat.entryPt.timeSec.toFixed(2)}s
                          </span>
                        </div>
                        <div>
                          <strong>Exit:</strong> 
                          <span 
                            style={{ color: "#007bff", textDecoration: "underline", cursor: "pointer", marginLeft: "4px" }}
                            onClick={() => context.seekPlayback?.(stat.exitPt.time)}
                            title="Click to jump to this timestamp"
                          >
                            {stat.exitPt.timeSec.toFixed(2)}s
                          </span>
                        </div>
                        <div style={{ marginTop: "4px" }}><strong>Duration:</strong> {stat.durationSec.toFixed(2)}s</div>
                        <div><strong>Distance:</strong> {stat.distanceMeters.toFixed(2)}m</div>
                        <div><strong>Speed:</strong> {stat.avgSpeedMps.toFixed(2)} m/s</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <strong style={{ fontSize: "16px" }}>No Zone Visits</strong>
            )}
          </div>
        )}

        {zoneStats.length > 0 && (
          <div style={{ fontSize: "12px", color: "#155724", textAlign: "center" }}>
            Click the Green (Entry) or Red (Exit) dots on the map to jump the timeline to that exact moment!
          </div>
        )}

        <hr style={{ width: "100%", margin: "8px 0", borderTop: "1px solid #ccc" }} />

        <button 
          style={{ padding: "8px 12px", background: "white", color: "black", border: "1px solid #ccc", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" }}
          onClick={handleClearTrajectory}
        >
          Clear Trajectory
        </button>

        <button 
          style={{ padding: "8px 12px", background: "white", color: "black", border: "1px solid #ccc", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" }}
          onClick={handleClearPolygon}
        >
          Clear Polygon
        </button>
        
        <div style={{ fontSize: "12px", color: "#666", marginTop: "auto" }}>
          * Draw a polygon on the map by clicking. The MCAP trajectory will load automatically.
        </div>
      </div>

      <div style={{ flex: 1, position: "relative" }}>
        <MapContainer ref={setMapRef} center={mapCenter} zoom={mapZoom} style={{ height: "100%", width: "100%", zIndex: 0 }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapInteractionHandler 
            onMapClick={(pt) => setPolygonPoints((prev) => [...prev, pt])}
            onMapUpdate={(center, zoom) => {
              setMapCenter(center);
              setMapZoom(zoom);
            }} 
          />
          
          {polygonPoints.length > 0 && (
            <Polygon 
              positions={polygonPoints} 
              color={zoneStats.length > 0 ? "#28a745" : "blue"} 
              fillColor={zoneStats.length > 0 ? "#28a745" : "blue"}
            />
          )}
          
          {polylinePositions.length > 0 && <Polyline positions={polylinePositions} color="red" weight={3} />}

          {zoneStats.map((stat, idx) => (
            <div key={`markers-${idx}`}>
              <CircleMarker 
                center={[stat.entryPt.lat, stat.entryPt.lng]} 
                radius={8} 
                color="white" 
                fillColor="#28a745" 
                fillOpacity={1} 
                weight={2}
                bubblingMouseEvents={false}
                eventHandlers={{
                  click: () => context.seekPlayback?.(stat.entryPt.time)
                }}
              >
                <Tooltip>Visit {idx + 1} Entry - Click to jump to {stat.entryPt.timeSec.toFixed(2)}s</Tooltip>
              </CircleMarker>

              <CircleMarker 
                center={[stat.exitPt.lat, stat.exitPt.lng]} 
                radius={8} 
                color="white" 
                fillColor="#dc3545" 
                fillOpacity={1} 
                weight={2}
                bubblingMouseEvents={false}
                eventHandlers={{
                  click: () => context.seekPlayback?.(stat.exitPt.time)
                }}
              >
                <Tooltip>Visit {idx + 1} Exit - Click to jump to {stat.exitPt.timeSec.toFixed(2)}s</Tooltip>
              </CircleMarker>
            </div>
          ))}

          {currentPos && (
            <CircleMarker
              center={[currentPos.lat, currentPos.lng]}
              radius={8}
              color="white"
              fillColor="#007bff"
              fillOpacity={1}
              weight={2}
            >
              <Tooltip>Current Robot Position</Tooltip>
            </CircleMarker>
          )}

        </MapContainer>
      </div>
    </div>
  );
}

export function initGeofenceAnalyzer(context: PanelExtensionContext): () => void {
  const root = createRoot(context.panelElement);
  root.render(<GeofenceAnalyzer context={context} />);

  return () => {
    root.unmount();
  };
}
