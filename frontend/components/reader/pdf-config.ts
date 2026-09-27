import { pdfjs } from "react-pdf"

// react-pdf needs the matching pdf.js worker bundle; Next.js resolves this as
// a static asset URL at build time so no external CDN is required.
pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()
