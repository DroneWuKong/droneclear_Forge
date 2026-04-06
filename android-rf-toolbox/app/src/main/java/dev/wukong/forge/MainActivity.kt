package dev.wukong.forge

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.wukong.forge.ui.*
import dev.wukong.forge.ui.tools.*

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { RFToolboxRoot() }
    }
}

enum class RFTool(val label: String, val icon: String, val desc: String, val color: Color) {
    TERRAIN("RF Terrain Map", "▲", "Real-terrain link analysis with elevation data", ForgeGreen),
    RANGE("Range Estimator", "↔", "Max range by protocol and terrain", ForgeAccent),
    LINK_BUDGET("Link Budget", "▦", "Full dB-by-dB waterfall", ForgeAccent),
    FRESNEL("Fresnel Zone", "◎", "Zone clearance calculator", ForgeTeal),
    CHANNEL("Channel Planner", "≋", "FPV channel conflict checker", ForgePurple),
    HARMONICS("Harmonics", "∿", "Harmonic frequencies + GPS warnings", ForgeRed),
    DIPOLE("Dipole Length", "⊤", "Half-wave element calculator", ForgeDim),
    COORD("Coordinate Convert", "⊕", "DD ↔ DMS ↔ MGRS ↔ UTM", ForgeOrange),
}

@Composable
fun RFToolboxRoot() {
    var activeTool by remember { mutableStateOf<RFTool?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(ForgeDark),
    ) {
        // Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(ForgeNav)
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (activeTool != null) {
                Text(
                    "←",
                    color = ForgeAccent,
                    fontSize = 18.sp,
                    fontFamily = Mono,
                    modifier = Modifier.clickable { activeTool = null }.padding(end = 12.dp),
                )
            }
            Column {
                Text(
                    activeTool?.label ?: "RF Toolbox",
                    color = if (activeTool != null) ForgeText else ForgeAccent,
                    fontSize = if (activeTool != null) 16.sp else 20.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = Mono,
                )
                if (activeTool == null) {
                    Text("UAS RF Planning Suite", color = ForgeDim, fontSize = 10.sp, fontFamily = Mono, letterSpacing = 2.sp)
                }
            }
            Spacer(Modifier.weight(1f))
            Text("AI Wingman", color = ForgeFaint, fontSize = 9.sp, fontFamily = Mono)
        }

        // Content
        if (activeTool == null) {
            ToolGrid { activeTool = it }
        } else {
            ToolContent(activeTool!!)
        }
    }
}

@Composable
fun ToolGrid(onSelect: (RFTool) -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        RFTool.entries.forEach { tool ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(ForgeCard, RoundedCornerShape(8.dp))
                    .clickable { onSelect(tool) }
                    .padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(tool.icon, color = tool.color, fontSize = 22.sp, modifier = Modifier.width(36.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(tool.label, color = ForgeText, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, fontFamily = Mono)
                    Text(tool.desc, color = ForgeDim, fontSize = 10.sp, fontFamily = Mono)
                }
                Text("→", color = ForgeFaint, fontSize = 16.sp, fontFamily = Mono)
            }
        }

        Spacer(Modifier.weight(1f))
        Text(
            "Buddy up.",
            color = ForgeTeal.copy(alpha = 0.4f),
            fontSize = 10.sp,
            fontFamily = Mono,
            modifier = Modifier.align(Alignment.CenterHorizontally).padding(16.dp),
        )
    }
}

@Composable
fun ToolContent(tool: RFTool) {
    when (tool) {
        RFTool.TERRAIN -> TerrainTool()
        RFTool.RANGE -> RangeEstimator()
        RFTool.LINK_BUDGET -> LinkBudgetTool()
        RFTool.FRESNEL -> FresnelTool()
        RFTool.CHANNEL -> ChannelPlanner()
        RFTool.HARMONICS -> HarmonicsTool()
        RFTool.DIPOLE -> DipoleTool()
        RFTool.COORD -> CoordinateConverter()
    }
}
