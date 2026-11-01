import * as maplibregl from "maplibre-gl";
import urlWorker from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

// A partir da v6 o worker é um arquivo separado, localizado em tempo de
// execução ao lado do bundle; o Vite não o copia sozinho. Com ?url ele vira um
// asset com hash, servido da própria origem (CSP worker-src 'self').
maplibregl.setWorkerUrl(urlWorker);

export { maplibregl };
