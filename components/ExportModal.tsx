import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Download, FileCode, Copy, Image as ImageIcon } from 'lucide-react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDownloadPng: () => void;
  onDownloadSvg: () => void;
  onCopySvg: () => void;
}

const badgeClass =
  "text-[10px] font-semibold uppercase tracking-[0.02em] px-1.5 py-0.5 rounded-[4px] bg-[var(--dial-surface-subtle)] text-[var(--dial-text-tertiary)]";

const buttonClass =
  "py-2.5 px-3 bg-[var(--dial-surface)] hover:bg-[var(--dial-surface-hover)] text-[var(--dial-text-secondary)] hover:text-[var(--dial-text-primary)] font-medium text-[13px] rounded-[var(--dial-radius)] flex items-center justify-center gap-1.5 transition-colors";

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  onDownloadPng,
  onDownloadSvg,
  onCopySvg,
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            id="modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />

          {/* Modal Container — styled with DialKit's own theme tokens so it matches the sidebar */}
          <motion.div
            id="modal-content"
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ type: 'spring', duration: 0.4, bounce: 0.15 }}
            data-theme="system"
            className="dialkit-root relative w-full max-w-md rounded-[14px] border border-[var(--dial-border)] bg-[var(--dial-glass-bg)] backdrop-blur-[var(--dial-backdrop-blur)] shadow-[var(--dial-shadow)] overflow-hidden flex flex-col z-10 text-[var(--dial-text-primary)]"
          >
            {/* Header */}
            <div className="flex justify-between items-center px-5 py-4 border-b border-[var(--dial-border)]">
              <div className="flex flex-col gap-0.5">
                <h3 className="text-[15px] font-semibold text-[var(--dial-text-primary)]">
                  Export Vector Masterpiece
                </h3>
                <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--dial-text-tertiary)]">
                  Select file format &amp; destination
                </span>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 text-[var(--dial-text-tertiary)] hover:text-[var(--dial-text-primary)] hover:bg-[var(--dial-surface-hover)] rounded-[var(--dial-radius)] transition-colors"
                title="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content Options */}
            <div className="p-5 space-y-4">
              <p className="text-[13px] leading-relaxed text-[var(--dial-text-secondary)]">
                Save your calligraphy with absolute fidelity. Choose SVG to preserve perfect curve control points or PNG for easy sharing.
              </p>

              {/* Formats */}
              <div className="space-y-3 pt-1">
                {/* Vector SVG Option */}
                <div className="p-4 rounded-[12px] border border-[var(--dial-border)] bg-[var(--dial-surface)] flex flex-col gap-3 hover:border-[var(--dial-border-hover)] transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className={badgeClass}>Vector</span>
                        <h4 className="text-[13px] font-semibold text-[var(--dial-text-primary)]">Scalable Vector Graphics (.svg)</h4>
                      </div>
                      <p className="text-[11px] mt-1 leading-normal text-[var(--dial-text-tertiary)]">
                        Perfect for Adobe Illustrator, Figma, or professional printing. Keeps control points editable.
                      </p>
                    </div>
                    <FileCode className="w-4 h-4 mt-0.5 shrink-0 text-[var(--dial-text-tertiary)]" />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        onDownloadSvg();
                        onClose();
                      }}
                      className={buttonClass}
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download SVG
                    </button>
                    <button
                      onClick={() => {
                        onCopySvg();
                        onClose();
                      }}
                      className={buttonClass}
                    >
                      <Copy className="w-3.5 h-3.5" />
                      Copy SVG Code
                    </button>
                  </div>
                </div>

                {/* Standard PNG Option */}
                <div className="p-4 rounded-[12px] border border-[var(--dial-border)] bg-[var(--dial-surface)] flex flex-col gap-3 hover:border-[var(--dial-border-hover)] transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className={badgeClass}>Raster</span>
                        <h4 className="text-[13px] font-semibold text-[var(--dial-text-primary)]">High-Resolution Image (.png)</h4>
                      </div>
                      <p className="text-[11px] mt-1 leading-normal text-[var(--dial-text-tertiary)]">
                        Ready to share on socials, insert in documents, or save directly to photos.
                      </p>
                    </div>
                    <ImageIcon className="w-4 h-4 mt-0.5 shrink-0 text-[var(--dial-text-tertiary)]" />
                  </div>

                  <button
                    onClick={() => {
                      onDownloadPng();
                      onClose();
                    }}
                    className={`w-full ${buttonClass}`}
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download High-Res PNG
                  </button>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div
              className="px-5 py-3 border-t border-[var(--dial-border)] flex items-center justify-between text-[10px] text-[var(--dial-text-tertiary)]"
              style={{ fontFamily: "'Geist Mono', monospace" }}
            >
              <span>Vector Spline Engine v1.1</span>
              <span>Perfect Bezier Precision</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
