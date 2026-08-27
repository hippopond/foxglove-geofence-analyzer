import { PanelExtensionContext } from "@foxglove/extension";
import { ReactElement, useEffect, useLayoutEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import { MapContainer, TileLayer, Polygon, Polyline, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point, polygon as turfPolygon } from "@turf/helpers";

function MapClickHandler({ onMapClick }: { onMapClick: (pt: [number, number]) => void }) {
  useMapEvents({
    click(e) {
      onMapClick([e.latlng.lat, e.latlng.lng]);
    },
  });
  return null;
}

function TestExtension({ context }: { context: PanelExtensionContext }): ReactElement {
  const [renderDone, setRenderDone] = useState<(() => void) | undefined>();
  const [polygonPoints, setPolygonPoints] = useState<[number, number][]>([]);
  
  // Extension State
  const [gpsTopic, setGpsTopic] = useState("/gps");
  const [trajectory, setTrajectory] = useState<[number, number][]>([]);
  const [isIntersecting, setIsIntersecting] = useState(false);
  
  const gpsTopicRef = useRef(gpsTopic);
  const polygonPointsRef = useRef(polygonPoints);

  // Keep refs updated for the render loop
  useEffect(() => {
    gpsTopicRef.current = gpsTopic;
    polygonPointsRef.current = polygonPoints;
    context.subscribe([{ topic: gpsTopic }]);
  }, [gpsTopic, polygonPoints, context]);

  useLayoutEffect(() => {
    context.onRender = (renderState, done) => {
      setRenderDone(() => done);
      
      if (renderState.currentFrame && renderState.currentFrame.length > 0) {
        const newPoints: [number, number][] = [];
        let latestLat: number | null = null;
        let latestLng: number | null = null;
        
        for (const msg of renderState.currentFrame) {
          if (msg.topic === gpsTopicRef.current && msg.message) {
            const data = msg.message as any;
            if (typeof data.latitude === 'number' && typeof data.longitude === 'number') {
              newPoints.push([data.latitude, data.longitude]);
              latestLat = data.latitude;
              latestLng = data.longitude;
            }
          }
        }
        
        if (newPoints.length > 0) {
          setTrajectory((prev) => [...prev, ...newPoints]);
          
          // Check Turf Intersection
          const currentPoly = polygonPointsRef.current;
          // Turf requires the first and last point to be identical to form a closed linear ring,
          // and needs at least 4 points (3 distinct + 1 closing). Leaflet doesn't require this.
          if (currentPoly.length >= 3 && latestLat !== null && latestLng !== null) {
            try {
              const pt = point([latestLng, latestLat]); // Turf uses [lon, lat]
              
              // Close the polygon for Turf
              const ring = currentPoly.map(p => [p[1], p[0]]); // Leaflet is [lat, lon], Turf is [lon, lat]
              if (ring[0]) { ring.push([...ring[0]]); } // Close the ring
              
              const poly = turfPolygon([ring]);
              const intersects = booleanPointInPolygon(pt, poly);
              setIsIntersecting(intersects);
            } catch (err) {
              console.error("Turf intersection error:", err);
            }
          } else {
            setIsIntersecting(false);
          }
        }
      }
    };
    
    context.watch("topics");
    context.watch("currentFrame");
    context.subscribe([{ topic: gpsTopicRef.current }]);
  }, [context]);

  useEffect(() => {
    renderDone?.();
  }, [renderDone]);

  const handleClearTrajectory = () => {
    setTrajectory([]);
    setIsIntersecting(false);
  };

  const handleClearPolygon = () => {
    setPolygonPoints([]);
    setIsIntersecting(false);
  };

  // Boston coordinates
  const position: [number, number] = [42.3601, -71.0589];

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
        <h3 style={{ margin: 0, padding: 0 }}>Foxglove Geospatial</h3>
        
        <div>
          <label style={{ display: "block", marginBottom: "4px", fontSize: "14px", fontWeight: "bold" }}>
            GPS Topic Name (contains LocationFix):
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
        
        <div style={{
          padding: "16px",
          background: isIntersecting ? "#d4edda" : "#f8d7da",
          border: `2px solid ${isIntersecting ? "#28a745" : "#dc3545"}`,
          borderRadius: "8px",
          textAlign: "center",
          fontWeight: "bold",
          fontSize: "18px",
          color: isIntersecting ? "#155724" : "#721c24",
          transition: "all 0.3s ease"
        }}>
          INTERSECTING:<br/>
          {isIntersecting ? "YES" : "NO"}
        </div>

        <hr style={{ width: "100%", margin: "8px 0", borderTop: "1px solid #ccc" }} />

        <button 
          style={{
            padding: "8px 12px",
            background: "white",
            color: "black",
            border: "1px solid #ccc",
            borderRadius: "4px",
            cursor: "pointer",
            fontWeight: "bold"
          }}
          onClick={handleClearTrajectory}
        >
          Clear Trajectory
        </button>

        <button 
          style={{
            padding: "8px 12px",
            background: "white",
            color: "black",
            border: "1px solid #ccc",
            borderRadius: "4px",
            cursor: "pointer",
            fontWeight: "bold"
          }}
          onClick={handleClearPolygon}
        >
          Clear Polygon
        </button>
        
        <div style={{ fontSize: "12px", color: "#666", marginTop: "auto" }}>
          * Draw a polygon on the map by clicking. Play the MCAP to trace the trajectory.
        </div>
      </div>

      <div style={{ flex: 1, position: "relative" }}>
        <MapContainer center={position} zoom={13} style={{ height: "100%", width: "100%", zIndex: 0 }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapClickHandler onMapClick={(pt) => setPolygonPoints((prev) => [...prev, pt])} />
          {polygonPoints.length > 0 && (
            <Polygon 
              positions={polygonPoints} 
              color={isIntersecting ? "#28a745" : "blue"} 
              fillColor={isIntersecting ? "#28a745" : "blue"}
            />
          )}
          {trajectory.length > 0 && <Polyline positions={trajectory} color="red" weight={3} />}
        </MapContainer>
      </div>
    </div>
  );
}

export function initTestExtension(context: PanelExtensionContext): () => void {
  const root = createRoot(context.panelElement);
  root.render(<TestExtension context={context} />);

  return () => {
    root.unmount();
  };
}
