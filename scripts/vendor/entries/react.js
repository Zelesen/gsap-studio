/*
 * ESM shim for React 19.
 *
 * React ships CommonJS with a dynamic `module.exports =` assignment, so
 * esbuild cannot statically detect its named exports and a bundle built
 * straight from the package only exposes a default export. Generated code
 * does `import { useState } from "react"`, so the named bindings have to be
 * re-exported explicitly.
 */
import React from "react";

export default React;

export const {
  Children,
  Component,
  Fragment,
  Profiler,
  PureComponent,
  StrictMode,
  Suspense,
  act,
  cache,
  cloneElement,
  createContext,
  createElement,
  createRef,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  startTransition,
  use,
  useActionState,
  useCallback,
  useContext,
  useDebugValue,
  useDeferredValue,
  useEffect,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  version,
} = React;
