import { Fraunces, Outfit } from "next/font/google";

export const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["500", "600"],
});
