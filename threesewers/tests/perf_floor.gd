extends SceneTree
# Floor test: an empty tree, nothing but the engine. Tells us how much of the
# measured frame cost is ours versus the runtime's baseline.
var n := 0
var tot := 0.0
var worst := 0.0
func _process(_d: float) -> bool:
	var ms := float(Performance.get_monitor(Performance.TIME_PROCESS)) * 1000.0
	n += 1; tot += ms; worst = maxf(worst, ms)
	if n >= 600:
		print("FLOOR frames=%d mean=%.2fms worst=%.2fms" % [n, tot / n, worst])
		quit(0)
	return false
