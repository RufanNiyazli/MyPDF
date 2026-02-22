import { useState } from "react";

import "./App.css";
import { readFile } from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-dialog";
import PDFViewer from "./Pdfviewer";
function App() {
  const [pdfData, setPdfData] = useState(null);
  const [fileName, setFileName] = useState("");
  const handleOpenPDF = async () => {
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
  const handleClosePDF = () => {
    setPdfData(null);
    setFileName("");
  };
  return (
    <div className="app-container">
      {/* Toolbar */}
      <div className="toolbar">
        <div className="toolbar-left">
          <button onClick={handleOpenPDF} className="btn-primary">
            📂 Open PDF
          </button>

          {fileName && (
            <>
              <span className="file-name">{fileName}</span>
              <button onClick={handleClosePDF} className="btn-secondary">
                ✕ Close
              </button>
            </>
          )}
        </div>

        <div className="toolbar-right">
          {pdfData && (
            <div className="toolbar-actions">
              <button className="btn-tool" title="Highlight">
                🖍️
              </button>
              <button className="btn-tool" title="Pen">
                ✏️
              </button>
              <button className="btn-tool" title="Text">
                📝
              </button>
              <button className="btn-tool" title="Eraser">
                🗑️
              </button>
            </div>
          )}
        </div>
      </div>

      {/* PDF Göstərmə Sahəsi */}
      <div className="content">
        {pdfData ? (
          <PDFViewer pdfData={pdfData} fileName={fileName} />
        ) : (
          <div className="welcome">
            <h1>📝 PDF Annotition</h1>
            <p>Click the button above to open the PDF file.</p>
            <div className="features">
              <div className="feature">
                <span className="feature-icon">🖍️</span>
                <span className="feature-text">Highlight</span>
              </div>
              <div className="feature">
                <span className="feature-icon">✏️</span>
                <span className="feature-text">Record</span>
              </div>
              <div className="feature">
                <span className="feature-icon">📝</span>
                <span className="feature-text">Textbox</span>
              </div>
              <div className="feature">
                <span className="feature-icon">🗑️</span>
                <span className="feature-text">Delete</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
