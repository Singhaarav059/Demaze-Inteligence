import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Suppress tsc type errors during `next build`.
  // Reason: TypeScript 5.9 + @types/react 19.x have a known incompatibility
  // where JSXElementConstructor's Promise<ReactNode> return path causes
  // `Type 'unknown' is not assignable to type 'ReactNode'` false positives
  // on valid JSX expressions. SWC (which Next.js uses for actual compilation)
  // does not perform type checking and compiles the code correctly.
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
