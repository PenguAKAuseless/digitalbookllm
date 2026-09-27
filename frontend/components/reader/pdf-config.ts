import { pdfjs } from "react-pdf"
import "react-pdf/dist/Page/TextLayer.css"

// react-pdf needs the matching pdf.js worker bundle; Next.js resolves this as
// a static asset URL at build time so no external CDN is required.
//
// The worker comes from the top-level `pdfjs-dist` package, while the API
// comes from the copy react-pdf depends on. They MUST be the same version
// ("The API version X does not match the Worker version Y" surfaces only as
// "Failed to load PDF file"), so package.json pins pdfjs-dist to exactly the
// version react-pdf declares. Bump both together.
pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()
