import { useState } from "react";

import "./App.css";
import { readFile } from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-dialog";
function App() {
  const [pdfData, setPdfData] = useState(null);
  const [fileName, setFileName] = useState("");
  const handleOpenPdf = async () => {
    try {
      const selected = await open({
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      console.log("Selected path:", selected);

      if (selected && typeof selected === "string") {
        const contents = await readFile(selected, { dir: null }); // Tauri v2
        console.log("File contents:", contents);
        setPdfData(contents);
        setFileName(selected.split("/").pop() || "Unnamed");
      }
    } catch (error) {
      console.error("there is error while uploading pdf!", error);
    }
  };
  return (
    <div className="app-container">
      {/* Toolbar */}
      <div className="toolbar">
        <button onClick={handleOpenPdf} className="btn-primary">
          📂 PDF Aç
        </button>
        {fileName && <span className="file-name">{fileName}</span>}
      </div>

      {/* PDF Göstərmə Sahəsi */}
      <div className="content">
        {pdfData ? (
          <div className="pdf-viewer">
            <p>✅ PDF yükləndi! ({pdfData.length} bytes)</p>
            <p>📄 Fayl: {fileName}</p>
            <p>Növbəti addımda PDF render edəcəyik...</p>
          </div>
        ) : (
          <div className="welcome">
            <h1>📝 PDF Annotator</h1>
            <p>PDF faylı açmaq üçün yuxarıdakı düyməyə klikləyin</p>
            <div className="features">
              <div className="feature">✏️ Qeyd et</div>
              <div className="feature">🖍️ Highlight</div>
              <div className="feature">📝 Textbox</div>
              <div className="feature">🗑️ Sil</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
