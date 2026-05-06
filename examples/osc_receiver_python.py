"""Simple OSC receiver in Python.

Useful as a relay (e.g. forward sukumo data to TouchDesigner over a different
port, or to a websocket for browser-based visualisation).

Install: pip install python-osc
Run:     python osc_receiver_python.py
"""

from pythonosc import dispatcher, osc_server


def on_temperature(_addr: str, value: float) -> None:
    print(f"Temperature: {value} C")


def on_electrode(addr: str, value: float) -> None:
    print(f"{addr}: {value} V")


def on_manual(addr: str, value: float) -> None:
    print(f"{addr}: {value}")


if __name__ == "__main__":
    d = dispatcher.Dispatcher()
    d.map("/sukumo/temperature", on_temperature)
    d.map("/sukumo/electrode/*", on_electrode)
    d.map("/sukumo/ph", on_manual)
    d.map("/sukumo/orp", on_manual)
    d.map("/sukumo/do", on_manual)

    server = osc_server.ThreadingOSCUDPServer(("0.0.0.0", 9000), d)
    print("Listening for sukumo OSC messages on port 9000. Ctrl+C to quit.")
    server.serve_forever()
