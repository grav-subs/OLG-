import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Download, FileCode, Copy, Sparkles, Check, Image as ImageIcon } from 'lucide-react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDownloadPng: () => void;
  onDownloadSvg: () => void;
  onCopySvg: () => void;
}

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
            className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
          />

          {/* Modal Container */}
          <motion.div
            id="modal-content"
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ type: 'spring', duration: 0.4, bounce: 0.15 }}
            className="relative w-full max-w-md bg-white rounded-2xl border border-stone-200 overflow-hidden flex flex-col z-10 text-stone-800"
          >
            {/* Header */}
            <div className="flex justify-between items-center px-6 py-4 border-b border-stone-150 bg-stone-50/50">
              <div className="flex flex-col">
                <h3 className="text-sm font-serif font-bold text-stone-900 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-500 animate-pulse-subtle" />
                  Export Vector Masterpiece
                </h3>
                <span className="text-[10px] text-stone-500 font-semibold uppercase tracking-wider">Select file format & destination</span>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors"
                title="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content Options */}
            <div className="p-6 space-y-4">
              <p className="text-stone-500 text-xs leading-relaxed">
                Save your calligraphy with absolute fidelity. Choose SVG to preserve perfect curve control points or PNG for easy sharing.
              </p>

              {/* Formats Container */}
              <div className="space-y-3 pt-2">
                {/* Vector SVG Option */}
                <div className="p-4 border border-emerald-100 rounded-xl bg-emerald-50/30 flex flex-col gap-3 hover:border-emerald-200 transition-colors">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="px-1.5 py-0.5 text-[9px] font-bold text-emerald-800 bg-emerald-100 rounded uppercase">Vector</span>
                        <h4 className="text-xs font-bold text-stone-900">Scalable Vector Graphics (.svg)</h4>
                      </div>
                      <p className="text-[11px] text-stone-500 mt-1 leading-normal">
                        Perfect for Adobe Illustrator, Figma, or professional printing. Keeps control points editable.
                      </p>
                    </div>
                    <FileCode className="w-5 h-5 text-emerald-600 mt-0.5" />
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <button
                      onClick={() => {
                        onDownloadSvg();
                        onClose();
                      }}
                      className="py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-lg flex items-center justify-center gap-1.5 transition-all"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download SVG
                    </button>
                    <button
                      onClick={() => {
                        onCopySvg();
                        onClose();
                      }}
                      className="py-2 px-3 bg-white hover:bg-emerald-50 text-emerald-800 font-semibold text-xs rounded-lg border border-emerald-200 flex items-center justify-center gap-1.5 transition-all"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      Copy SVG Code
                    </button>
                  </div>
                </div>

                {/* Standard PNG Option */}
                <div className="p-4 border border-stone-200 rounded-xl bg-stone-50/40 flex flex-col gap-3 hover:border-stone-300 transition-colors">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="px-1.5 py-0.5 text-[9px] font-bold text-stone-600 bg-stone-200 rounded uppercase font-semibold">Raster</span>
                        <h4 className="text-xs font-bold text-stone-900">High-Resolution Image (.png)</h4>
                      </div>
                      <p className="text-[11px] text-stone-500 mt-1 leading-normal">
                        Ready to share on socials, insert in documents, or save directly to photos.
                      </p>
                    </div>
                    <ImageIcon className="w-5 h-5 text-stone-500 mt-0.5" />
                  </div>

                  <button
                    onClick={() => {
                      onDownloadPng();
                      onClose();
                    }}
                    className="w-full py-2 px-3 bg-stone-900 hover:bg-stone-800 text-white font-semibold text-xs rounded-lg flex items-center justify-center gap-1.5 transition-all"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download High-Res PNG
                  </button>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-3.5 bg-stone-50 border-t border-stone-150 flex items-center justify-between text-[10px] text-stone-400 font-mono">
              <span>Vector Spline Engine v1.1</span>
              <span>Perfect Bezier Precision</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
