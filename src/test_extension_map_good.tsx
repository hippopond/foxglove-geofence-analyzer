import { PanelExtensionContext } from "@foxglove/extension";
import { ReactElement, useEffect, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MapContainer, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";

function ExamplePanel({ context }: { context: PanelExtensionContext }): ReactElement {
  const [renderDone, setRenderDone] = useState<(() => void) | undefined>();

  useLayoutEffect(() => {
    context.onRender = (_renderState, done) => {
      setRenderDone(() => done);
    };
    
    context.watch("topics");
  }, [context]);

  useEffect(() => {
    renderDone?.();
  }, [renderDone]);

  // Boston coordinates
  const position: [number, number] = [42.3601, -71.0589];

  return (
    <div style={{ height: "100%", width: "100%" }}>
      <MapContainer center={position} zoom={13} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
      </MapContainer>
    </div>
  );
}

export function initExamplePanel(context: PanelExtensionContext): () => void {
  const root = createRoot(context.panelElement);
  root.render(<ExamplePanel context={context} />);

  return () => {
    root.unmount();
  };
}
