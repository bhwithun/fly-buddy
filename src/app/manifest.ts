import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "fly-buddy",
    short_name: "fly-buddy",
    description: "Track an arrival and know when to leave for the airport.",
    start_url: "/",
    display: "standalone",
    background_color: "#090d16",
    theme_color: "#090d16",
  };
}
