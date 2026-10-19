/* ESM shim for react-dom 19 (CommonJS with a dynamic module.exports). */
import ReactDOM from "react-dom";

export default ReactDOM;

export const {
  createPortal,
  flushSync,
  preconnect,
  prefetchDNS,
  preinit,
  preinitModule,
  preinitStyle,
  preload,
  preloadModule,
  requestFormReset,
  unstable_batchedUpdates,
  useFormState,
  useFormStatus,
  version,
} = ReactDOM;
