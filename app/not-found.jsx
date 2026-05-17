import Link from 'next/link';

export default function NotFoundPage() {
    return (
        <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 flex items-center justify-center px-4">
            <div className="text-center max-w-md">
                <div className="w-24 h-24 bg-gray-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-6">
                    <svg className="w-12 h-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                </div>
                <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">404</h1>
                <h2 className="text-xl font-medium text-gray-700 dark:text-gray-300 mb-4">Page Not Found</h2>
                <p className="text-gray-500 dark:text-gray-400 mb-8">
                    Oops! The page you're looking for doesn't exist or has been moved.
                </p>
                <Link
                    href="/"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-black dark:bg-white text-white dark:text-black rounded-xl font-medium hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                    Go Back Home
                </Link>
            </div>
        </div>
    );
}
