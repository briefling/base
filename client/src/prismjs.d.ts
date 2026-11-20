// Minimal types for the part of prismjs we use (tokenize only), instead of a @types dependency.
declare module 'prismjs' {
  export interface Token { type: string; alias?: string | string[]; content: string | Token | Array<string | Token> }
  const Prism: { languages: Record<string, object | undefined>; tokenize(text: string, grammar: object): Array<string | Token> };
  export default Prism;
}
declare module 'prismjs/components/*';
