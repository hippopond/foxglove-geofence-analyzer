import { PanelExtensionContext } from "@foxglove/extension";
import { ReactElement, useEffect, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MapContainer, TileLayer, Polygon, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";

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
  const [apiKey, setApiKey] = useState("");
  const [mcapNames, setMcapNames] = useState<string[]>([]);

  useLayoutEffect(() => {
    context.onRender = (_renderState, done) => {
      setRenderDone(() => done);
    };
    
    context.watch("topics");
  }, [context]);

  useEffect(() => {
    renderDone?.();
  }, [renderDone]);

  const fetchMcaps = async () => {
    if (!apiKey) {
      setMcapNames(["Please enter an API key"]);
      return;
    }
    
    try {
      const res = await fetch("https://api.foxglove.dev/v1/recordings", {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        }
      });
      
      if (!res.ok) {
        setMcapNames([`API Error: ${res.status}`]);
        return;
      }
      
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const firstFour = data.slice(0, 4).map((rec: any) => rec.path || rec.id || "Unknown Name");
        setMcapNames(firstFour);
      } else {
        setMcapNames(["No MCAPs found"]);
      }
    } catch (err) {
      setMcapNames(["Error fetching data"]);
    }
  };

  // Boston coordinates
  const position: [number, number] = [42.3601, -71.0589];

  return (
    <div style={{ display: "flex", height: "100%", width: "100%" }}>
      <div style={{ 
        width: "300px", 
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
        <h3 style={{ margin: 0, padding: 0 }}>Control Panel</h3>
        
        <div>
          <label style={{ display: "block", marginBottom: "4px", fontSize: "14px", fontWeight: "bold" }}>Foxglove API Key:</label>
          <input 
            type="password" 
            value={apiKey} 
            onChange={(e) => setApiKey(e.target.value)} 
            style={{ width: "100%", padding: "6px", boxSizing: "border-box" }} 
            placeholder="fox_sk_..."
          />
        </div>
        
        <button 
          onClick={fetchMcaps} 
          style={{ 
            padding: "8px", 
            cursor: "pointer",
            background: "#0052cc",
            color: "white",
            border: "none",
            borderRadius: "4px",
            fontWeight: "bold"
          }}
        >
          Fetch MCAPs
        </button>

        {mcapNames.length > 0 && (
          <div style={{ 
            background: "#e9ecef", 
            padding: "10px", 
            borderRadius: "4px", 
            fontSize: "14px"
          }}>
            <strong>Results:</strong>
            <ol style={{ margin: "8px 0 0 0", paddingLeft: "20px", wordBreak: "break-all" }}>
              {mcapNames.map((name, idx) => (
                <li key={idx} style={{ marginBottom: "4px" }}>{name}</li>
              ))}
            </ol>
          </div>
        )}

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
          onClick={() => setPolygonPoints([])}
        >
          Clear Polygon
        </button>
      </div>

      <div style={{ flex: 1, position: "relative" }}>
        <MapContainer center={position} zoom={13} style={{ height: "100%", width: "100%", zIndex: 0 }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapClickHandler onMapClick={(pt) => setPolygonPoints((prev) => [...prev, pt])} />
          {polygonPoints.length > 0 && <Polygon positions={polygonPoints} color="blue" />}
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
