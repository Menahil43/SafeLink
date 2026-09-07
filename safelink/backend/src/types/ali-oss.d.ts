// Ambient declaration for `ali-oss`.
//
// The `ali-oss` package ships no bundled TypeScript types and `@types/ali-oss`
// is not installed in this environment, which otherwise breaks `tsc --strict`
// (TS7016). This shim types the small surface the app actually uses so the
// build compiles offline. Replace with `npm i -D @types/ali-oss` for full typings.
declare module 'ali-oss' {
  class OSS {
    constructor(options?: any);
    signatureUrl(name: string, options?: any): string;
    delete(name: string, options?: any): Promise<any>;
    [key: string]: any;
  }
  export default OSS;
}
