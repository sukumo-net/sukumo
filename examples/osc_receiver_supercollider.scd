// Sukumo OSC receiver for SuperCollider.
// Run line by line (Cmd+Enter).

// 1. Boot the server
s.boot;

// 2. Listen for sukumo OSC messages on port 9000
(
~temp = OSCFunc({ |msg|
    ("Temperature: " ++ msg[1] ++ " C").postln;
}, '/sukumo/temperature', recvPort: 9000);

~electrode = OSCFunc({ |msg, time, addr, recvPort|
    (addr.asString ++ ": " ++ msg[1] ++ " V").postln;
}, '/sukumo/electrode/sfc_w', recvPort: 9000);

// Match all electrode addresses
~allElectrodes = OSCFunc({ |msg, time, addr|
    msg.postln;
}, recvPort: 9000);
)

// 3. Stop listening
~temp.free; ~electrode.free; ~allElectrodes.free;

/*
Example sonification: map surface electrode voltages to a 4-voice drone.
Voltages typically range 0.0..0.5V. Map that to a frequency range.
*/
(
SynthDef(\drone, { |freq=200, amp=0.1|
    var sig = SinOsc.ar(freq) * SinOsc.kr(0.3).range(0.5, 1) * amp;
    Out.ar(0, sig.dup);
}).add;
)

(
~voices = ();
~handler = OSCFunc({ |msg, time, addr|
    var key = addr.asString.split($/).last.asSymbol;
    var voltage = msg[1];
    var freq = voltage.linexp(0.0, 0.5, 100, 800);
    if (~voices[key].isNil) {
        ~voices[key] = Synth(\drone, [\freq, freq, \amp, 0.05]);
    } {
        ~voices[key].set(\freq, freq);
    };
}, recvPort: 9000);
)

// Cleanup
~handler.free;
~voices.do(_.free);
