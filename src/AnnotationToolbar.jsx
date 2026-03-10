import { useState } from "react";
import "./AnnotationToolbar.css";

const tools = [
  {
    id: "select",
    label: "Select",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M4 0l16 12-7 1-4 9z" />
      </svg>
    ),
  },
  {
    id: "pen",
    label: "Pen",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    ),
  },
  {
    id: "highlighter",
    label: "Highlight",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
      </svg>
    ),
  },
  {
    id: "text",
    label: "Text",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="4 7 4 4 20 4 20 7" />
        <line x1="9" y1="20" x2="15" y2="20" />
        <line x1="12" y1="4" x2="12" y2="20" />
      </svg>
    ),
  },
  {
    id: "rectangle",
    label: "Rectangle",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="6" width="18" height="13" rx="1" />
      </svg>
    ),
  },
  {
    id: "circle",
    label: "Ellipse",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <ellipse cx="12" cy="12" rx="10" ry="7" />
      </svg>
    ),
  },
  {
    id: "arrow",
    label: "Arrow",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="5" y1="19" x2="19" y2="5" />
        <polyline points="9 5 19 5 19 15" />
      </svg>
    ),
  },
  {
    id: "eraser",
    label: "Eraser",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20 20H7L3 16l11-11 7 7-1 8z" />
        <line x1="6" y1="17" x2="9" y2="14" />
      </svg>
    ),
  },
];

const COLORS = [
  "#EF4444",
  "#F97316",
  "#EAB308",
  "#22C55E",
  "#3B82F6",
  "#8B5CF6",
  "#EC4899",
  "#000000",
  "#FFFFFF",
];

function AnnotationToolbar({ onToolChange, onUndo, onRedo, onClear }) {
  const [activeTool, setActiveTool] = useState("select");
  const [selectedColor, setSelectedColor] = useState("#3B82F6");
  const [brushWidth, setBrushWidth] = useState(3);
  const [showColorPicker, setShowColorPicker] = useState(false);

  const handleToolChange = (tool) => {
    setActiveTool(tool);
    if (onToolChange) {
      onToolChange(tool, { color: selectedColor, brushWidth });
    }
  };

  const handleColorChange = (color) => {
    setSelectedColor(color);
    setShowColorPicker(false);
    if (onToolChange) {
      onToolChange(activeTool, { color, brushWidth });
    }
  };

  const handleWidthChange = (w) => {
    setBrushWidth(w);
    if (onToolChange) {
      onToolChange(activeTool, { color: selectedColor, brushWidth: w });
    }
  };

  const showWidth = ["pen", "rectangle", "circle", "arrow"].includes(activeTool);
  const widthPresets = [1, 3, 5, 8, 12];

  return (
    <div className="annotation-sidebar">
      <div className="sidebar-tools">
        {tools.map((tool) => (
          <button
            key={tool.id}
            className={`sidebar-btn ${activeTool === tool.id ? "active" : ""}`}
            onClick={() => handleToolChange(tool.id)}
            title={tool.label}
          >
            {tool.icon}
            <span className="sidebar-tooltip">{tool.label}</span>
          </button>
        ))}
      </div>

      <div className="sidebar-divider" />

      <div className="sidebar-color-section">
        <button
          className="color-preview-btn"
          style={{ backgroundColor: selectedColor }}
          onClick={() => setShowColorPicker((v) => !v)}
          title="Color"
        />
        {showColorPicker && (
          <div className="color-popup">
            {COLORS.map((c) => (
              <button
                key={c}
                className={`color-dot ${selectedColor === c ? "active" : ""}`}
                style={{ backgroundColor: c }}
                onClick={() => handleColorChange(c)}
                title={c}
              />
            ))}
          </div>
        )}
      </div>

      {showWidth && (
        <div className="sidebar-width">
          {widthPresets.map((w) => (
            <button
              key={w}
              className={`width-preset-btn ${brushWidth === w ? "active" : ""}`}
              onClick={() => handleWidthChange(w)}
              title={`${w}px`}
            >
              <div
                className="width-preset-dot"
                style={{
                  width: `${Math.max(w, 2)}px`,
                  height: `${Math.max(w, 2)}px`,
                  backgroundColor: brushWidth === w ? "#3b82f6" : "#64748b",
                }}
              />
            </button>
          ))}
        </div>
      )}

      <div className="sidebar-divider" />

      <div className="sidebar-actions">
        <button className="sidebar-btn" onClick={onUndo} title="Undo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 14 4 9 9 4" />
            <path d="M20 20v-7a4 4 0 00-4-4H4" />
          </svg>
          <span className="sidebar-tooltip">Undo</span>
        </button>
        <button className="sidebar-btn" onClick={onRedo} title="Redo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 14 20 9 15 4" />
            <path d="M4 20v-7a4 4 0 014-4h12" />
          </svg>
          <span className="sidebar-tooltip">Redo</span>
        </button>
        <button className="sidebar-btn danger" onClick={onClear} title="Clear All">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
          </svg>
          <span className="sidebar-tooltip">Clear All</span>
        </button>
      </div>
    </div>
  );
}

export default AnnotationToolbar;