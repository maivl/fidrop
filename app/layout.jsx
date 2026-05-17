import { Geist, Geist_Mono } from "next/font/google";
import localFont from 'next/font/local';
import "./globals.css";

const sfPro = localFont({
    src: [
        {
            path: './fonts/SFProDisplay-Regular.ttf',
            weight: '400',
            style: 'normal',
        },
        {
            path: './fonts/SFProDisplay-RegularItalic.ttf',
            weight: '400',
            style: 'italic',
        },
        {
            path: './fonts/SFProDisplay-Bold.ttf',
            weight: '700',
            style: 'normal',
        },
        {
            path: './fonts/SFProDisplay-BoldItalic.ttf',
            weight: '700',
            style: 'italic',
        },
    ],
    variable: '--font-sf-pro',
    display: 'swap',
});

const geistSans = Geist({
    variable: "--font-geist-sans",
    subsets: ["latin"],
    display: 'swap',
});

const geistMono = Geist_Mono({
    variable: "--font-geist-mono",
    subsets: ["latin"],
    display: 'swap',
});

export const metadata = {
    title: "fiDrop - Seamless File Sharing",
    description: "Peer-to-peer file sharing application with WebRTC technology. Fast, secure, and private file transfers.",
    keywords: "file sharing, p2p, webrtc, file transfer, secure sharing",
    authors: [{ name: "figuran04" }],
    viewport: "width=device-width, initial-scale=1",
    themeColor: "#000000",
    icons: {
        icon: "/favicon.ico",
        apple: "/apple-icon.png",
    },
};

export default function RootLayout({ children }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                <meta charSet="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
            </head>
            <body
                className={`${sfPro.variable} ${geistSans.variable} ${geistMono.variable} antialiased`}
                suppressHydrationWarning
            >
                {children}
            </body>
        </html>
    );
}
