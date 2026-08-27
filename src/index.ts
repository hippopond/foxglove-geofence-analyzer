import { ExtensionContext } from "@foxglove/extension";

import { initGeofenceAnalyzer } from "./GeofenceAnalyzer";

export function activate(extensionContext: ExtensionContext): void {
  extensionContext.registerPanel({ name: "Geofence Analyzer", initPanel: initGeofenceAnalyzer });
}
