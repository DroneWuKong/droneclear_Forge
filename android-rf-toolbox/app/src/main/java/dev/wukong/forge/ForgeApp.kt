package dev.wukong.forge

import android.app.Application
import org.osmdroid.config.Configuration

class ForgeApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Configuration.getInstance().userAgentValue = packageName
        // Enable offline tile cache for maps
        Configuration.getInstance().osmdroidBasePath = cacheDir
        Configuration.getInstance().osmdroidTileCache = cacheDir.resolve("tiles")
    }
}
