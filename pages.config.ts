import { definePages } from "./vendor/pages/src/index.ts";

export default definePages({
  source: "dist/site",
  out: "dist/site-pages",
  assets: "assets/pages",
  copy: [
    { from: "version.json", to: "version.json" }
  ],
  pages: [
    { from: "index.html", route: "/" },
    { from: "generator.html", route: "/generator.html", keepSource: true },
    { from: "generator.html", route: "/generator/", keepSource: true, baseHref: "../" },
    { from: "visualise.html", route: "/visualise.html", keepSource: true },
    { from: "visualise.html", route: "/visualise/", keepSource: true, baseHref: "../" },
    { from: "about.html", route: "/about.html", keepSource: true },
    { from: "about.html", route: "/about/", keepSource: true, baseHref: "../" },
    { from: "parts/img2svg.html", route: "/parts/img2svg.html", keepSource: true },
    { from: "parts/svg2bin.html", route: "/parts/svg2bin.html", keepSource: true },
    { from: "vectorise.html", route: "/vectorise/", inject: false, keepSource: true, baseHref: "../" },
    { from: "generate.html", route: "/generate/", inject: false, keepSource: true, baseHref: "../" }
  ],
  css: {
    files: ["kofi.css"]
  },
  runtime: {
    base: "/sandsara-track-viewer/",
    theme: {
      key: "sandsara.theme",
      colours: {
        light: "#f3eee4",
        dark: "#18211d"
      },
      toggle: "[data-theme-toggle]"
    },
    kofi: {
      user: "kittycrow",
      header: ".site-header",
      footer: ".footer-links",
      footerText: "Buy me a coffee",
      separator: "",
      desktopText: "Buy me a coffee?",
      background: "#5bc0de",
      text: "#323842",
      wideAt: 721
    },
    version: {
      file: "version.json"
    },
    readme: {
      owner: "kitty-crow",
      repo: "sandsara-track-viewer",
      branch: "main",
      path: "README.md",
      content: "#readmeContent",
      status: "#readmeStatus"
    }
  }
});
