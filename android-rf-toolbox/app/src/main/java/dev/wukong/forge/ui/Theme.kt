package dev.wukong.forge.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily

// ── Forge Design System ──────────────────────────────────────────────────────

val ForgeDark       = Color(0xFF0B0F14)
val ForgeCard       = Color(0xFF111820)
val ForgeNav        = Color(0xFF0D1117)
val ForgeBorder     = Color(0xFF21262D)
val ForgeText       = Color(0xFFC9D1D9)
val ForgeDim        = Color(0xFF8B949E)
val ForgeFaint      = Color(0xFF484F58)
val ForgeTeal       = Color(0xFF4ECDC4)
val ForgeAccent     = Color(0xFF22D3EE)  // cyan accent (Forge brand)
val ForgeRed        = Color(0xFFEF4444)
val ForgeGreen      = Color(0xFF4ADE80)
val ForgeYellow     = Color(0xFFEAB308)
val ForgePurple     = Color(0xFF8B5CF6)
val ForgeBlue       = Color(0xFF3B82F6)
val ForgeOrange     = Color(0xFFF59E0B)

val Mono = FontFamily.Monospace

// Category colors (matching Forge web)
val CatColors = mapOf(
    "enterprise" to ForgePurple,
    "blue_uas" to ForgeBlue,
    "tactical" to ForgeRed,
    "isr" to ForgeAccent,
    "loitering" to ForgeOrange,
    "fixed_wing" to Color(0xFF0EA5E9),
    "ucav" to Color(0xFFDC2626),
    "tethered" to Color(0xFF6366F1),
    "agriculture" to ForgeGreen,
    "mapping" to Color(0xFF14B8A6),
    "open_source" to ForgeTeal,
    "specialty" to ForgeDim,
)
