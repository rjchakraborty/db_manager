import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | "default"
    | "destructive"
    | "outline"
    | "secondary"
    | "ghost"
    | "link";
  size?: "default" | "sm" | "lg" | "icon";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black disabled:pointer-events-none disabled:opacity-50",
          {
            "bg-black text-white hover:bg-gray-800 hover:text-white focus:text-white":
              variant === "default",
            "bg-black text-white hover:bg-gray-700 hover:text-white focus:text-white":
              variant === "destructive",
            "border border-black bg-white text-black hover:bg-black hover:text-white focus:bg-black focus:text-white":
              variant === "outline",
            "bg-gray-100 text-black border border-gray-300 hover:bg-gray-200 hover:text-black focus:text-black":
              variant === "secondary",
            "text-black hover:bg-gray-100 hover:text-black focus:text-black":
              variant === "ghost",
            "text-black underline-offset-4 hover:underline hover:text-black focus:text-black":
              variant === "link",
          },
          {
            "h-10 px-4 py-2": size === "default",
            "h-9 rounded-md px-3": size === "sm",
            "h-11 rounded-md px-8": size === "lg",
            "h-10 w-10": size === "icon",
          },
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button };
