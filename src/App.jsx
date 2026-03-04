import Want3DGallery from "./components/Want3DGallery";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Want3DGallery />} />
        <Route path="/category/:categorySlug" element={<Want3DGallery />} />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
    </HashRouter>
  );
}
