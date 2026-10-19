import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "../../lib/store";

export function PromptDialog() {
  const prompt = useStore((s) => s.prompt);
  const ask = useStore((s) => s.ask);
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!prompt) return;
    setValue(prompt.value);
    setTimeout(() => (input.current?.focus(), input.current?.select()), 30);
  }, [prompt]);
  const done = () => {
    if (!prompt || !value.trim()) return;
    prompt.onConfirm(value.trim());
    ask(null);
  };
  return (
    <AnimatePresence>
      {prompt && (
        <motion.div className="fixed inset-0 grid place-items-center" style={{ zIndex: 90, background: "rgba(5,5,8,.22)" }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={(e) => e.target === e.currentTarget && ask(null)}>
          <motion.form
            className="glass-3 w-[340px] rounded-[14px] p-4"
            initial={{ y: 8, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            onSubmit={(e) => (e.preventDefault(), done())}
            onKeyDown={(e) => e.key === "Escape" && ask(null)}
          >
            <div className="text-[15px] font-semibold mb-3">{prompt.title}</div>
            <input
              ref={input}
              className="w-full h-[32px] px-2.5 rounded-[8px] text-[13px] outline-none"
              style={{ background: "var(--e1)", border: "1px solid var(--edge)", color: "var(--text)" }}
              placeholder={prompt.placeholder}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" className="tbtn" onClick={() => ask(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={!value.trim()}>{prompt.confirm}</button>
            </div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
