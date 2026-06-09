model NestedDemo "nested-modifier completion fixture"
  partial model Pin
    parameter Real pinParam = 1;
  end Pin;
  model Leaf
    extends Pin;
    parameter Real leafParam = 2;
  end Leaf;
  model Mid
    Leaf sub;
  end Mid;
  Mid m;
equation
end NestedDemo;
