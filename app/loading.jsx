export default function LoadingPage() {
    return (
        <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 flex items-center justify-center">
            <div className="text-center">
                <div className="relative">
                    {/* Spinner */}
                    <div className="w-16 h-16 border-4 border-gray-200 dark:border-zinc-700 border-t-black dark:border-t-white rounded-full animate-spin mx-auto mb-4"></div>

                    {/* Pulsa animation */}
                    <div className="absolute inset-0 w-16 h-16 mx-auto rounded-full animate-ping bg-black/10 dark:bg-white/10"></div>
                </div>
                <p className="text-gray-500 dark:text-gray-400 mt-4 font-medium">Loading...</p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Please wait while we prepare everything</p>
            </div>
        </div>
    );
}
