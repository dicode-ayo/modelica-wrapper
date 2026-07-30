within ResistorDemo;

model Resistor "Ideal linear electrical resistor"
  parameter Real R(unit = "Ohm") = 1 "Resistance";
  Real v "Voltage drop";
  Real i "Current";
  Modelica.Blocks.Continuous.LimPID PI1(k = 100, Ti = 0.1, yMax = 12, Ni = 0.1, initType = Modelica.Blocks.Types.Init.SteadyState, controllerType = Modelica.Blocks.Types.SimpleController.PI, limiter.u.start = 0, Td = 0.1) annotation(
    Placement(transformation(extent = {{198, -160}, {218, -140}})));
  Modelica.Mechanics.Rotational.Components.Inertia inertia1(phi.fixed = true, phi.start = 0, J = 1, a.fixed = true, a.start = 0) annotation(
    Placement(transformation(extent = {{22, 0}, {42, 20}})));
  Modelica.Mechanics.Rotational.Sources.Torque torque1 annotation(
    Placement(transformation(extent = {{-5, 0}, {15, 20}})));
  Modelica.Mechanics.Rotational.Components.SpringDamper spring1(c = 1e4, d = 100, stateSelect = StateSelect.prefer, w_rel.fixed = true) annotation(
    Placement(transformation(extent = {{52, 0}, {72, 20}})));
  Modelica.Mechanics.Rotational.Components.Inertia inertia2(J = 2) annotation(
    Placement(transformation(extent = {{80, 0}, {100, 20}})));
  Modelica.Blocks.Sources.KinematicPTP kinematicPTP1(startTime = 0.5, deltaq = {driveAngle}, qd_max = {1}, qdd_max = {1}) annotation(
    Placement(transformation(extent = {{162, -120}, {182, -100}})));
  Modelica.Blocks.Continuous.Integrator integrator1(initType = Modelica.Blocks.Types.Init.InitialState) annotation(
    Placement(transformation(extent = {{192, -120}, {212, -100}})));
  Modelica.Mechanics.Rotational.Sensors.SpeedSensor speedSensor1 annotation(
    Placement(transformation(extent = {{42, -30}, {22, -10}})));
  Modelica.Mechanics.Rotational.Sources.ConstantTorque loadTorque1(tau_constant = 10, useSupport = false) annotation(
    Placement(transformation(extent = {{118, 5}, {108, 15}})));
equation
  v = R*i;
  connect(spring1.flange_b, inertia2.flange_a) annotation(
    Line(points = {{72, 10}, {80, 10}}));
  connect(inertia1.flange_b, spring1.flange_a) annotation(
    Line(points = {{42, 10}, {52, 10}}));
  connect(torque1.flange, inertia1.flange_a) annotation(
    Line(points = {{15, 10}, {22, 10}}));
  connect(kinematicPTP1.y[1], integrator1.u) annotation(
    Line(points = {{183, -110}, {190, -110}}, color = {0, 0, 127}));
  connect(speedSensor1.flange, inertia1.flange_b) annotation(
    Line(points = {{42, -20}, {42, 10}}));
  connect(loadTorque1.flange, inertia2.flange_b) annotation(
    Line(points = {{108, 10}, {100, 10}}));
  connect(PI1.y, torque1.tau) annotation(
    Line(points = {{219, -150}, {106, -150}, {106, 10}, {-7, 10}}, color = {0, 0, 127}));
  connect(speedSensor1.w, PI1.u_m) annotation(
    Line(points = {{21, -20}, {114.5, -20}, {114.5, -162}, {208, -162}}, color = {0, 0, 127}));
  connect(integrator1.y, PI1.u_s) annotation(
    Line(points = {{213, -110}, {217, -110}, {217, -129}, {187, -129}, {187, -150}, {196, -150}}, color = {0, 0, 127}));
  annotation(
    Icon(graphics = {Rectangle(extent = {{-70, 30}, {70, -30}}, lineColor = {0, 0, 255}), Line(points = {{-90, 0}, {-70, 0}}), Line(points = {{70, 0}, {90, 0}}), Text(extent = {{-90, 60}, {90, 40}}, textString = "%name")}),
    Diagram(graphics = {Rectangle(origin = {20, 20}, lineColor = {255, 0, 0}, fillColor = {0, 0, 0}, pattern = LinePattern.Solid, fillPattern = FillPattern.None, lineThickness = 0.25, borderPattern = BorderPattern.None, extent = {{136, -112}, {202, -152}}, radius = 0), Text(origin = {20, 20}, extent = {{78, 130}, {146, 122}}, textString = "reference speed generation", fontSize = 0, textColor = {255, 0, 0}, horizontalAlignment = TextAlignment.Center), Text(origin = {20, 20}, extent = {{-98, -46}, {-60, -52}}, textString = "PI controller", fontSize = 0, textColor = {255, 0, 0}, horizontalAlignment = TextAlignment.Center), Line(visible = true, origin = {20, 20}, rotation = 0, points = {{-76, -44}, {-56, -22}}, color = {30, 0, 255}, pattern = LinePattern.Solid, thickness = 0.25, arrow = {Arrow.None, Arrow.Filled}, arrowSize = 3, smooth = Smooth.None), Rectangle(origin = {20, 20}, lineColor = {255, 0, 0}, fillColor = {0, 0, 0}, pattern = LinePattern.Solid, fillPattern = FillPattern.None, lineThickness = 0.25, borderPattern = BorderPattern.None, extent = {{-24, 6}, {100, -50}}, radius = 0), Text(origin = {20, 20}, extent = {{4, 14}, {71, 7}}, textString = "plant (simple drive train)", fontSize = 0, textColor = {255, 0, 0}, horizontalAlignment = TextAlignment.Center)}));
end Resistor;