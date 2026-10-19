import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error("ZWall UI error:", error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="h-full grid place-items-center p-8 text-center">
        <div>
          <div className="text-[20px] font-semibold">Something in the UI broke</div>
          <div className="text-[13px] mt-1" style={{ color: "var(--text-2)" }}>Your wallpapers are fine: they run in the engine, not in this window.</div>
          <button className="btn mt-4" onClick={() => location.reload()}>Reload the window</button>
        </div>
      </div>
    );
  }
}
