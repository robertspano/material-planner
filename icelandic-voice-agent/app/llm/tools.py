"""Tool definitions and execution for Claude function calling.

Each tool allows Claude to take actions during the conversation
(search inventory, book test drives, etc.).
"""

import json
from datetime import datetime

from app.utils.logging import get_logger

logger = get_logger(__name__)

TOOLS = [
    {
        "name": "search_inventory",
        "description": (
            "Leita að bílum á lager. Skilar lista af tiltækum bílum "
            "sem passa við leitarskilyrði."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "make": {
                    "type": "string",
                    "description": "Tegund bíls (t.d. 'Tesla', 'Toyota', 'Volvo')",
                },
                "model": {
                    "type": "string",
                    "description": "Gerð bíls (t.d. 'Model 3', 'RAV4')",
                },
                "max_price": {
                    "type": "number",
                    "description": "Hámarksverð í ISK",
                },
                "fuel_type": {
                    "type": "string",
                    "enum": ["rafmagn", "bensín", "dísel", "hybrid", "tengiltvinn"],
                    "description": "Eldsneytistegund",
                },
                "year_min": {
                    "type": "integer",
                    "description": "Lágmarksárgerð",
                },
            },
            "required": [],
        },
    },
    {
        "name": "book_test_drive",
        "description": (
            "Bóka reynsluakstur. Krefst nafns, símanúmers, bíls og dagsetningar."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "customer_name": {
                    "type": "string",
                    "description": "Nafn viðskiptavinar",
                },
                "phone_number": {
                    "type": "string",
                    "description": "Símanúmer",
                },
                "vehicle_id": {
                    "type": "string",
                    "description": "Auðkenni bíls af lager",
                },
                "preferred_date": {
                    "type": "string",
                    "description": "Dagsetning (YYYY-MM-DD)",
                },
                "preferred_time": {
                    "type": "string",
                    "description": "Tími (HH:MM)",
                },
            },
            "required": [
                "customer_name",
                "phone_number",
                "vehicle_id",
                "preferred_date",
            ],
        },
    },
    {
        "name": "get_business_hours",
        "description": "Sækja opnunartíma bílaumboðsins.",
        "input_schema": {
            "type": "object",
            "properties": {
                "day": {
                    "type": "string",
                    "enum": [
                        "mánudagur",
                        "þriðjudagur",
                        "miðvikudagur",
                        "fimmtudagur",
                        "föstudagur",
                        "laugardagur",
                        "sunnudagur",
                    ],
                    "description": "Dagur vikunnar",
                },
            },
            "required": [],
        },
    },
    {
        "name": "transfer_to_agent",
        "description": (
            "Tengja viðskiptavin við mannlegan sölumann. Nota ef viðskiptavinur "
            "biður um það eða ef spurningin er of flókin."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "description": "Ástæða fyrir tilfærslu",
                },
                "department": {
                    "type": "string",
                    "enum": ["sala", "þjónusta", "varahlutir", "fjármögnun"],
                    "description": "Deild",
                },
            },
            "required": ["reason"],
        },
    },
]

# Mock data for tool execution (replace with real database/API in production)
_MOCK_INVENTORY = [
    {
        "id": "DB-001",
        "make": "Tesla",
        "model": "Model Y",
        "year": 2024,
        "color": "hvítur",
        "price_isk": 8_900_000,
        "fuel_type": "rafmagn",
        "mileage_km": 3200,
    },
    {
        "id": "DB-002",
        "make": "BMW",
        "model": "X3",
        "year": 2023,
        "color": "svartur",
        "price_isk": 9_500_000,
        "fuel_type": "dísel",
        "mileage_km": 22000,
    },
    {
        "id": "DB-003",
        "make": "Toyota",
        "model": "RAV4",
        "year": 2023,
        "color": "grár",
        "price_isk": 6_800_000,
        "fuel_type": "hybrid",
        "mileage_km": 18000,
    },
    {
        "id": "DB-004",
        "make": "Mercedes-Benz",
        "model": "GLC",
        "year": 2024,
        "color": "silfur",
        "price_isk": 12_500_000,
        "fuel_type": "tengiltvinn",
        "mileage_km": 5000,
    },
    {
        "id": "DB-005",
        "make": "Kia",
        "model": "EV6",
        "year": 2024,
        "color": "blár",
        "price_isk": 7_500_000,
        "fuel_type": "rafmagn",
        "mileage_km": 1500,
    },
    {
        "id": "DB-006",
        "make": "Volvo",
        "model": "XC40",
        "year": 2023,
        "color": "rauður",
        "price_isk": 8_200_000,
        "fuel_type": "rafmagn",
        "mileage_km": 12000,
    },
]

_BUSINESS_HOURS = {
    "mánudagur": {"open": "10:00", "close": "18:00"},
    "þriðjudagur": {"open": "10:00", "close": "18:00"},
    "miðvikudagur": {"open": "10:00", "close": "18:00"},
    "fimmtudagur": {"open": "10:00", "close": "18:00"},
    "föstudagur": {"open": "10:00", "close": "18:00"},
    "laugardagur": {"open": "12:00", "close": "15:00"},
    "sunnudagur": None,  # Lokað
}


async def execute_tool(tool_name: str, tool_input: dict) -> str:
    """Execute a tool and return the result as a string for Claude.

    In production, these would connect to real databases/APIs.
    """
    logger.info("tool_execute", tool=tool_name, input=tool_input)

    if tool_name == "search_inventory":
        return _search_inventory(tool_input)
    elif tool_name == "book_test_drive":
        return _book_test_drive(tool_input)
    elif tool_name == "get_business_hours":
        return _get_business_hours(tool_input)
    elif tool_name == "transfer_to_agent":
        return _transfer_to_agent(tool_input)
    else:
        return json.dumps({"error": f"Óþekkt verkfæri: {tool_name}"})


def _search_inventory(params: dict) -> str:
    """Search vehicle inventory with optional filters."""
    results = _MOCK_INVENTORY.copy()

    if make := params.get("make"):
        results = [v for v in results if v["make"].lower() == make.lower()]
    if model := params.get("model"):
        results = [v for v in results if v["model"].lower() == model.lower()]
    if max_price := params.get("max_price"):
        results = [v for v in results if v["price_isk"] <= max_price]
    if fuel_type := params.get("fuel_type"):
        results = [v for v in results if v["fuel_type"] == fuel_type]
    if year_min := params.get("year_min"):
        results = [v for v in results if v["year"] >= year_min]

    return json.dumps(
        {"count": len(results), "vehicles": results},
        ensure_ascii=False,
    )


def _book_test_drive(params: dict) -> str:
    """Book a test drive appointment."""
    # Validate the vehicle exists
    vehicle_id = params.get("vehicle_id", "")
    vehicle = next(
        (v for v in _MOCK_INVENTORY if v["id"] == vehicle_id), None
    )
    if not vehicle:
        return json.dumps(
            {"success": False, "error": f"Bíll {vehicle_id} fannst ekki á lager."},
            ensure_ascii=False,
        )

    booking = {
        "success": True,
        "booking_id": f"BK-{datetime.now().strftime('%Y%m%d%H%M')}",
        "customer_name": params["customer_name"],
        "phone_number": params["phone_number"],
        "vehicle": f"{vehicle['year']} {vehicle['make']} {vehicle['model']} ({vehicle['color']})",
        "date": params["preferred_date"],
        "time": params.get("preferred_time", "10:00"),
    }
    return json.dumps(booking, ensure_ascii=False)


def _get_business_hours(params: dict) -> str:
    """Get business hours for a specific day or all days."""
    day = params.get("day")
    if day:
        hours = _BUSINESS_HOURS.get(day)
        if hours is None:
            return json.dumps(
                {"day": day, "status": "lokað"},
                ensure_ascii=False,
            )
        return json.dumps(
            {"day": day, "open": hours["open"], "close": hours["close"]},
            ensure_ascii=False,
        )

    # Return all days
    all_hours = {}
    for d, h in _BUSINESS_HOURS.items():
        if h is None:
            all_hours[d] = "lokað"
        else:
            all_hours[d] = f"{h['open']} - {h['close']}"
    return json.dumps(all_hours, ensure_ascii=False)


def _transfer_to_agent(params: dict) -> str:
    """Transfer the call to a human agent."""
    return json.dumps(
        {
            "success": True,
            "message": "Tilfærsla í vinnslu",
            "department": params.get("department", "sala"),
            "reason": params["reason"],
            "estimated_wait": "um eina mínútu",
        },
        ensure_ascii=False,
    )
