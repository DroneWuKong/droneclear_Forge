#!/usr/bin/env python3
"""
mine_ai_accelerators.py — Mine edge AI accelerator products for drone applications.

Targets AI inference chips and modules used in drone vision/autonomy:
  - Hailo (8, 10H) — dataflow NPU
  - Ambarella (CV5, CV7) — vision SoC
  - NVIDIA (Jetson Orin) — GPU compute
  - Google (Coral Edge TPU) — USB accelerator
  - Kneron, DeepX, Kinara, Axelera, Syntiant — emerging edge AI
  - Qualcomm (RB5) — 5G + AI platform
  - Intel (Movidius Myriad X) — VPU

Usage:
    python3 miners/defense/mine_ai_accelerators.py
    python3 miners/defense/mine_ai_accelerators.py --dry-run
"""

import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from validate_entry import validate_part, validate_parts_batch

CATEGORY = "ai_accelerators"
PID_PREFIX = "AIACCEL"
DB_PATH = os.path.join(os.path.dirname(__file__), '..', '..',
                       'DroneClear Components Visualizer', 'forge_database.json')

MANUFACTURERS = {
    "hailo": {
        "name": "Hailo Technologies", "hq": "Tel Aviv, Israel", "country": "Israel",
        "products": [
            {"name": "Hailo-8 M.2 AI Accelerator Module", "description": "26 TOPS in M.2 at 2.5W. Dataflow architecture. 100% utilization, linear stacking to 104 TOPS. TensorFlow/PyTorch/ONNX. Passive cooling.", "link": "https://hailo.ai/products/ai-accelerators/", "approx_price": 99, "ai_compute_tops": 26, "power_w": 2.5, "architecture": "Dataflow", "form_factor": "M.2 Key M", "interface": "PCIe Gen-3.0 x4", "supported_frameworks": ["TensorFlow", "PyTorch", "ONNX"], "stacking": "Up to 4x (104 TOPS)", "passive_cooling": True, "weight_g": 8, "compliance": {}, "tags": ["26_tops", "2.5w", "m2", "dataflow", "yolo", "stackable", "passive_cooling"]},
            {"name": "Hailo-10H — Edge AI Accelerator with GenAI", "description": "40 TOPS with GenAI/LLM/VLM on-device. M.2 with 4/8GB LPDDR4. Sub-1s first token, 10+ tok/s on 2B models. YOLOv11m on 4K at 2.5W. AEC-Q100 Grade 2.", "link": "https://hailo.ai/products/ai-accelerators/hailo-10h-m-2-ai-acceleration-module/", "approx_price": 149, "ai_compute_tops": 40, "power_w": 2.5, "architecture": "Dataflow (2nd gen)", "form_factor": "M.2 Key M (2242, 2280)", "interface": "PCIe Gen-3.0 x4", "onboard_ram": "4/8 GB LPDDR4/4X", "genai_capable": True, "llm_performance": "10+ tokens/sec on 2B models", "automotive_qualified": "AEC-Q100 Grade 2", "weight_g": 12, "compliance": {"aec_q100": True}, "tags": ["40_tops", "genai", "llm", "vlm", "4k_realtime", "automotive_qualified"]},
        ],
    },
    "ambarella": {
        "name": "Ambarella", "hq": "Santa Clara, CA, USA", "country": "United States",
        "products": [
            {"name": "Ambarella CV5 — AI Vision SoC for Drones", "description": "20+ TOPS vision SoC with CVflow AI + ISP. 8K video, multi-camera, CNN/transformer. L1-L4 autonomy. DJI heritage.", "link": "https://www.ambarella.com/", "approx_price": "Contact vendor (OEM)", "ai_compute_tops": 20, "architecture": "CVflow AI + ISP", "video_capability": "8K encoding", "supported_networks": ["CNN", "transformer"], "autonomy_levels": "L1-L4", "isp_integrated": True, "form_factor": "SoC", "compliance": {"ndaa": True}, "tags": ["soc", "cvflow", "8k", "isp", "drone_vision", "autonomy"]},
            {"name": "Ambarella CV7 — Multi-Stream AI Vision SoC", "description": "Latest-gen CVflow AI SoC. Quad Cortex-A73, 64-bit DRAM, 8K multi-stream CNN/transformer. Drones, robotics, automotive.", "link": "https://www.ambarella.com/", "approx_price": "Contact vendor (OEM)", "ai_compute_tops": 30, "architecture": "CVflow AI (3rd gen) + ISP", "cpu_cores": "Quad ARM Cortex-A73", "video_capability": "8K multi-stream", "form_factor": "SoC", "compliance": {"ndaa": True}, "tags": ["cv7", "multi_stream", "8k", "cortex_a73", "transformer"]},
        ],
    },
    "nvidia": {
        "name": "NVIDIA", "hq": "Santa Clara, CA, USA", "country": "United States",
        "products": [
            {"name": "NVIDIA Jetson Orin Nano — Edge AI Module for Autonomous Drones", "description": "40 TOPS Ampere GPU. CUDA, TensorRT, JetPack, ROS 2. SLAM, VIO, object detection. ARK Electronics NDAA carrier available. 7-15W configurable.", "link": "https://www.nvidia.com/en-us/autonomous-machines/embedded-systems/jetson-orin/", "approx_price": 199, "ai_compute_tops": 40, "power_w": "7-15", "architecture": "NVIDIA Ampere GPU + ARM Cortex-A78AE", "gpu_cores": 1024, "form_factor": "SO-DIMM module", "supported_frameworks": ["CUDA", "TensorRT", "PyTorch", "TensorFlow", "ONNX"], "ros2_support": True, "slam_capable": True, "ndaa_carrier": "ARK Electronics 'Just a Jetson'", "weight_g": 25, "compliance": {"ndaa": True}, "tags": ["jetson", "cuda", "tensorrt", "ros2", "slam", "vio", "40_tops", "ampere"]},
        ],
    },
    "google": {
        "name": "Google", "hq": "Mountain View, CA, USA", "country": "United States",
        "products": [
            {"name": "Google Coral USB Accelerator — Edge TPU", "description": "4 TOPS USB AI accelerator using Edge TPU. Simplest integration path. TensorFlow Lite. Popular for prototyping.", "link": "https://coral.ai/products/accelerator/", "approx_price": 60, "ai_compute_tops": 4, "power_w": 2.5, "architecture": "Edge TPU", "form_factor": "USB dongle", "interface": "USB 3.0", "supported_frameworks": ["TensorFlow Lite"], "weight_g": 25, "compliance": {}, "tags": ["usb", "edge_tpu", "prototyping", "tensorflow_lite", "low_cost"]},
        ],
    },
    "qualcomm": {
        "name": "Qualcomm", "hq": "San Diego, CA, USA", "country": "United States",
        "products": [
            {"name": "Qualcomm Robotics RB5 — 5G + AI Platform for Drones", "description": "15 TOPS with 5G mmWave/sub-6, Wi-Fi 6, BT 5.1. 7 cameras. Heterogeneous compute. Linux + ROS 2.", "link": "https://www.qualcomm.com/products/technology/robotics", "approx_price": 399, "ai_compute_tops": 15, "power_w": 10, "architecture": "Qualcomm AI Engine (CPU+GPU+DSP+NPU)", "connectivity": ["5G", "Wi-Fi 6", "BT 5.1"], "camera_inputs": 7, "form_factor": "SoM", "ros2_support": True, "weight_g": 35, "compliance": {"ndaa": True}, "tags": ["5g", "15_tops", "qualcomm", "ros2", "7_cameras"]},
        ],
    },
    "kneron": {
        "name": "Kneron", "hq": "San Diego, CA, USA", "country": "United States",
        "products": [
            {"name": "Kneron KL720 — Edge AI SoC", "description": "Edge AI processor with transformer model support. CNN + RNN/transformer NPU. Low cost/power for simpler inference.", "link": "https://www.kneron.com/", "approx_price": 30, "ai_compute_tops": 1.5, "power_w": 1, "architecture": "NPU (CNN + transformer)", "form_factor": "SoC module", "transformer_support": True, "weight_g": 5, "compliance": {}, "tags": ["transformer", "low_power", "low_cost", "edge_soc"]},
        ],
    },
    "deepx": {
        "name": "DeepX", "hq": "Seoul, South Korea", "country": "South Korea",
        "products": [
            {"name": "DeepX DX-M1 — 25 TOPS Edge AI Accelerator", "description": "25 TOPS in 5W. Proprietary quantization: INT8 with FP32-comparable accuracy. Co-processor for drones/robots.", "link": "https://www.deepx.ai/", "approx_price": "Contact vendor", "ai_compute_tops": 25, "power_w": 5, "architecture": "NPU with proprietary quantization", "form_factor": "co-processor module / PCIe card", "weight_g": 30, "compliance": {"allied_nation": True}, "tags": ["25_tops", "5w", "quantization", "co_processor"]},
        ],
    },
    "kinara": {
        "name": "Kinara", "hq": "San Jose, CA, USA", "country": "United States",
        "products": [
            {"name": "Kinara Ara-2 — GenAI Edge Accelerator", "description": "50 TOPS in 6W. Models up to 30B INT4. Llama2-7B tens of tok/s. StableDiffusion 1.4. VLIW architecture.", "link": "https://www.kinara.ai/", "approx_price": "Contact vendor", "ai_compute_tops": 50, "power_w": 6, "architecture": "VLIW + dedicated AI cores", "genai_capable": True, "max_model_params": "30B INT4", "form_factor": "chip / module", "weight_g": 15, "compliance": {"ndaa": True}, "tags": ["genai", "30b_params", "llama2", "stable_diffusion", "vliw"]},
        ],
    },
    "axelera": {
        "name": "Axelera AI", "hq": "Eindhoven, Netherlands", "country": "Netherlands",
        "products": [
            {"name": "Axelera AI Metis — 214 TOPS Edge AI Chip", "description": "214 TOPS peak at 14.7 TOPS/W. Quad-core digital in-memory compute with RISC-V. 10W typical.", "link": "https://www.axelera.ai/", "approx_price": "Contact vendor", "ai_compute_tops": 214, "tops_per_watt": 14.7, "power_w": 10, "architecture": "Digital in-memory compute + RISC-V", "form_factor": "chip / PCIe card", "compliance": {"allied_nation": True}, "tags": ["214_tops", "in_memory_compute", "risc_v", "high_performance"]},
        ],
    },
    "syntiant": {
        "name": "Syntiant", "hq": "Irvine, CA, USA", "country": "United States",
        "products": [
            {"name": "Syntiant NDP250 — Ultra-Low Power Edge AI", "description": "Microwatts for always-on, milliwatts for full vision. 5x throughput vs prior gen. Vision, speech, sensor processing.", "link": "https://www.syntiant.com/", "approx_price": 15, "ai_compute_tops": 0.5, "power_w": 0.01, "architecture": "Neural Decision Processor", "form_factor": "ultra-compact chip", "always_on": True, "weight_g": 1, "compliance": {"ndaa": True}, "tags": ["microwatt", "always_on", "ultra_low_power", "battery_friendly"]},
        ],
    },
    "intel": {
        "name": "Intel", "hq": "Santa Clara, CA, USA", "country": "United States",
        "products": [
            {"name": "Intel Movidius Myriad X VPU (Neural Compute Stick 2)", "description": "4 TOPS VPU in USB form factor. OpenVINO toolkit. TensorFlow/PyTorch/ONNX. Academic/prototyping.", "link": "https://www.intel.com/", "approx_price": 69, "ai_compute_tops": 4, "power_w": 1.5, "architecture": "Movidius Myriad X VPU", "form_factor": "USB stick", "supported_frameworks": ["TensorFlow", "PyTorch", "ONNX", "OpenVINO"], "weight_g": 30, "compliance": {"ndaa": True}, "tags": ["usb", "vpu", "openvino", "movidius", "prototyping"]},
        ],
    },
}

def load_db():
    with open(DB_PATH) as f: return json.load(f)
def save_db(db):
    with open(DB_PATH, 'w') as f: json.dump(db, f, indent=2, ensure_ascii=False)

def get_next_pid(existing):
    max_num = 0
    for e in existing:
        pid = e.get('pid', '')
        if pid.startswith(PID_PREFIX + '-'):
            try: max_num = max(max_num, int(pid.split('-')[1]))
            except: pass
    return max_num + 1

def build_entries():
    entries = []; pid_counter = 1
    for mfr_key, mfr in MANUFACTURERS.items():
        for product in mfr['products']:
            entry = {"pid": f"{PID_PREFIX}-{pid_counter:04d}", "category": CATEGORY,
                     "manufacturer": mfr['name'], "manufacturer_hq": mfr['hq'], "country": mfr['country'],
                     **product, "schema_data": {"weight_g": product.get('weight_g')}}
            valid, reason = validate_part(entry)
            if valid: entries.append(entry); pid_counter += 1
            else: print(f"  REJECTED: {product['name']} — {reason}")
    return entries

def mine_ai_accelerators(dry_run=False):
    print(f"═══ Mining {CATEGORY} ═══\n")
    entries = build_entries()
    valid, rejected = validate_parts_batch(entries)
    print(f"\n  Built {len(valid)} valid entries from {len(MANUFACTURERS)} manufacturers")
    if dry_run:
        for e in valid: print(f"    [{e['pid']}] {e['name']}")
        return
    db = load_db(); existing = db['components'].get(CATEGORY, [])
    existing_names = {e['name'].lower() for e in existing}
    added = 0; next_pid = get_next_pid(existing)
    for entry in valid:
        if entry['name'].lower() not in existing_names:
            entry['pid'] = f"{PID_PREFIX}-{next_pid:04d}"; existing.append(entry)
            existing_names.add(entry['name'].lower()); next_pid += 1; added += 1
            print(f"  + {entry['pid']}: {entry['name']}")
        else: print(f"  = SKIP (exists): {entry['name']}")
    db['components'][CATEGORY] = existing; save_db(db)
    print(f"\n  ✓ {added} new. Total {CATEGORY}: {len(existing)}")

if __name__ == '__main__':
    mine_ai_accelerators(dry_run='--dry-run' in sys.argv)
