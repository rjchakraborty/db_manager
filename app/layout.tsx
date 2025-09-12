import "./globals.css";
import React from "react";

export const metadata = {
    title: 'DB Manager - AI-Powered Database Tool',
    description: 'Manage your PostgreSQL databases with AI assistance',
}

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en" className="h-full">
            <body className="h-full bg-white text-black antialiased">
                {children}
            </body>
        </html>
    );
}


