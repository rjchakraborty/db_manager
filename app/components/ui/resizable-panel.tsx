"use client";

import React, { useState, useRef, useEffect, ReactNode } from "react";

interface ResizablePanelProps {
    children: ReactNode;
    defaultWidth?: number;
    minWidth?: number;
    maxWidth?: number;
    className?: string;
    storageKey?: string; // For persisting width in localStorage
    position?: 'left' | 'right'; // Position of the resize handle
}

export function ResizablePanel({
    children,
    defaultWidth = 300,
    minWidth = 200,
    maxWidth = 800,
    className = "",
    storageKey,
    position = 'right'
}: ResizablePanelProps) {
    const [width, setWidth] = useState(defaultWidth);
    const [isResizing, setIsResizing] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);
    const startXRef = useRef(0);
    const startWidthRef = useRef(0);

    // Load width from localStorage on mount
    useEffect(() => {
        if (storageKey && typeof window !== "undefined") {
            const savedWidth = localStorage.getItem(storageKey);
            if (savedWidth) {
                const parsedWidth = parseInt(savedWidth, 10);
                if (parsedWidth >= minWidth && parsedWidth <= maxWidth) {
                    setWidth(parsedWidth);
                }
            }
        }
    }, [storageKey, minWidth, maxWidth]);

    // Save width to localStorage when it changes
    useEffect(() => {
        if (storageKey && typeof window !== "undefined") {
            localStorage.setItem(storageKey, width.toString());
        }
    }, [width, storageKey]);

    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsResizing(true);
        startXRef.current = e.clientX;
        startWidthRef.current = width;

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
    };

    const handleMouseMove = (e: MouseEvent) => {
        if (!isResizing) return;

        const deltaX = e.clientX - startXRef.current;
        // For left-positioned handles, we need to invert the delta
        const adjustedDelta = position === 'left' ? -deltaX : deltaX;
        const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidthRef.current + adjustedDelta));
        setWidth(newWidth);
    };

    const handleMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
    };

    return (
        <div className="flex h-full">
            {/* Resizable Handle - Left Position */}
            {position === 'left' && (
                <div
                    className={`w-1 bg-gray-200 hover:bg-gray-400 cursor-col-resize transition-all duration-200 relative group flex-shrink-0 ${isResizing ? "bg-gray-500 w-2" : ""
                        }`}
                    style={{ minWidth: '4px' }}
                >
                    {/* Main handle area */}
                    <div
                        className="absolute inset-0 cursor-col-resize z-20"
                        onMouseDown={handleMouseDown}
                    />

                    {/* Visual indicator */}
                    <div className="absolute inset-y-0 left-0 w-full bg-gray-500 opacity-0 group-hover:opacity-100 transition-opacity" />

                    {/* Expanded hover area for easier grabbing */}
                    <div
                        className="absolute inset-y-0 -left-2 -right-2 w-5 cursor-col-resize z-10"
                        onMouseDown={handleMouseDown}
                    />

                    {/* Drag indicator dots */}
                    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-60 transition-opacity pointer-events-none">
                        <div className="flex flex-col space-y-1">
                            <div className="w-1 h-1 bg-gray-600 rounded-full"></div>
                            <div className="w-1 h-1 bg-gray-600 rounded-full"></div>
                            <div className="w-1 h-1 bg-gray-600 rounded-full"></div>
                        </div>
                    </div>
                </div>
            )}

            <div
                ref={panelRef}
                className={`flex-shrink-0 ${className}`}
                style={{ width: `${width}px` }}
            >
                {children}
            </div>

            {/* Resizable Handle - Right Position */}
            {position === 'right' && (
                <div
                    className={`w-1 bg-gray-200 hover:bg-gray-400 cursor-col-resize transition-all duration-200 relative group flex-shrink-0 ${isResizing ? "bg-gray-500 w-2" : ""
                        }`}
                    style={{ minWidth: '4px' }}
                >
                    {/* Main handle area */}
                    <div
                        className="absolute inset-0 cursor-col-resize z-20"
                        onMouseDown={handleMouseDown}
                    />

                    {/* Visual indicator */}
                    <div className="absolute inset-y-0 left-0 w-full bg-gray-500 opacity-0 group-hover:opacity-100 transition-opacity" />

                    {/* Expanded hover area for easier grabbing */}
                    <div
                        className="absolute inset-y-0 -left-2 -right-2 w-5 cursor-col-resize z-10"
                        onMouseDown={handleMouseDown}
                    />

                    {/* Drag indicator dots */}
                    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-60 transition-opacity pointer-events-none">
                        <div className="flex flex-col space-y-1">
                            <div className="w-1 h-1 bg-gray-600 rounded-full"></div>
                            <div className="w-1 h-1 bg-gray-600 rounded-full"></div>
                            <div className="w-1 h-1 bg-gray-600 rounded-full"></div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

interface ResizableContainerProps {
    children: ReactNode;
    className?: string;
}

export function ResizableContainer({ children, className = "" }: ResizableContainerProps) {
    return (
        <div className={`flex h-full overflow-hidden ${className}`}>
            {children}
        </div>
    );
}
