import { forwardRef, useCallback, type CSSProperties, type HTMLAttributes, type Ref } from "react";
import { useCardGlow } from "~/lib/use-card-glow";

type CardFrameProps = HTMLAttributes<HTMLElement> & {
  as?: "div" | "aside" | "nav" | "section";
  frame?: "square" | "slanted";
  glow?: boolean;
  focused?: boolean;
  solid?: boolean;
};

// Linear flat theme: cards are a single hairline-bordered surface. The visual
// detail (border color, radius, shadow, focused/solid variants) lives in the
// `.mc-card-frame` rules in styles.css; this component just sets the box model.
const frameBaseStyle: CSSProperties = {
  boxSizing: "border-box",
  borderStyle: "solid",
  borderWidth: 1,
  overflow: "hidden",
  position: "relative",
};

export const CardFrame = forwardRef<HTMLElement, CardFrameProps>(function CardFrame(
  { as: Component = "div", frame = "square", glow = false, focused = false, solid = false, style, className, ...props },
  forwardedRef
) {
  const glowRef = useCardGlow<HTMLElement>();
  void frame;
  const setRef = useCallback(
    (node: HTMLElement | null) => {
      glowRef(glow ? node : null);
      assignRef(forwardedRef, node);
    },
    [forwardedRef, glow, glowRef]
  );
  const mergedClassName = ["mc-card-frame", className].filter(Boolean).join(" ");

  return (
    <Component
      {...props}
      ref={setRef}
      className={mergedClassName}
      data-focused={focused ? "true" : undefined}
      data-solid={solid ? "true" : undefined}
      style={{
        ...frameBaseStyle,
        ...style,
      }}
    />
  );
});

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(value);
  } else {
    ref.current = value;
  }
}
