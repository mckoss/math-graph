/** Ambient declaration for importing YAML files as raw text via Vite. */

declare module '*.yaml?raw' {
  const content: string;
  export default content;
}
