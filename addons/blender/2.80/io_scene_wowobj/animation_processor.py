def process_texture_transform(transform_data):
    """Convert M2Track data to animation rates"""
    result = {
        'translate_rate': [0.0, 0.0],
        'rotate_rate': 0.0,
        'scale_rate': [0.0, 0.0],
        'has_animation': False,
        'animation_type': 'none'
    }
    
    if not transform_data:
        return result
    
    translation_track = transform_data.get('translation')
    
    if translation_track and translation_track.get('timestamps') and translation_track.get('values'):
        timestamps = translation_track['timestamps']
        values = translation_track['values']
        
        actual_values = []
        actual_timestamps = []
        
        if len(values) == 1 and isinstance(values[0], list) and len(values[0]) > 1:
            actual_values = values[0]
            # Create synthetic timestamps if we only have one timestamp
            if len(timestamps) == 1:
                # Handle case where timestamp might be a list or single value
                base_time = timestamps[0][0] if isinstance(timestamps[0], list) else timestamps[0]
                actual_timestamps = [base_time + i * 1000 for i in range(len(actual_values))]
            else:
                actual_timestamps = timestamps
        else:
            actual_values = values
            actual_timestamps = timestamps
        
        if len(actual_timestamps) > 1 and len(actual_values) > 1:
            # Get first and last values to determine overall direction
            first_val = actual_values[0] if len(actual_values[0]) >= 2 else [0.0, 0.0]
            last_val = actual_values[-1] if len(actual_values[-1]) >= 2 else [0.0, 0.0]
            
            # Calculate total change over total time
            total_time = (actual_timestamps[-1] - actual_timestamps[0]) / 1000.0  # To seconds
            total_change_x = last_val[0] - first_val[0]
            total_change_y = last_val[1] - first_val[1]
            
            deltas_x = []
            deltas_y = []
            time_deltas = []
            
            for i in range(1, len(actual_timestamps)):
                time_delta = actual_timestamps[i] - actual_timestamps[i-1]
                if time_delta > 0:
                    # Values are arrays of [x, y, z], we only need x and y for UV
                    value_delta_x = actual_values[i][0] - actual_values[i-1][0] if len(actual_values[i]) > 0 else 0.0
                    value_delta_y = actual_values[i][1] - actual_values[i-1][1] if len(actual_values[i]) > 1 else 0.0
                    
                    deltas_x.append(value_delta_x)
                    deltas_y.append(value_delta_y)
                    time_deltas.append(time_delta)
            
            if deltas_x and time_deltas and total_time > 0:
                # Calculate average rate
                avg_delta_x = sum(deltas_x) / len(deltas_x)
                avg_delta_y = sum(deltas_y) / len(deltas_y)
                avg_time_delta = sum(time_deltas) / len(time_deltas)
                
                calculated_rate_x = (avg_delta_x / avg_time_delta) * 1000.0
                calculated_rate_y = (avg_delta_y / avg_time_delta) * 1000.0
                
                min_change_threshold = 0.01 # better value?
                if abs(total_change_x) > min_change_threshold or abs(total_change_y) > min_change_threshold:
                    result['has_animation'] = True
                    result['animation_type'] = 'translation'
                    
                    min_rate = 0.1
                    
                    # Flippy flip
                    if abs(calculated_rate_x) > 0:
                        result['translate_rate'][0] = calculated_rate_x  # X stays the same?
                    elif abs(total_change_x) > min_change_threshold:
                        result['translate_rate'][0] = min_rate if total_change_x > 0 else -min_rate
                    
                    if abs(calculated_rate_y) > 0:
                        result['translate_rate'][1] = -calculated_rate_y  # Y is negated
                    elif abs(total_change_y) > min_change_threshold:
                        result['translate_rate'][1] = -min_rate if total_change_y > 0 else min_rate
    
    # Process rotation track  
    rotation_track = transform_data.get('rotation')
    if rotation_track and rotation_track.get('timestamps') and rotation_track.get('values'):
        timestamps = rotation_track['timestamps']
        values = rotation_track['values']
        
        if len(timestamps) > 1 and len(values) > 1:
            # Get first and last quaternion values to determine overall rotation
            first_quat = values[0] if len(values[0]) >= 4 else [0.0, 0.0, 0.0, 1.0]
            last_quat = values[-1] if len(values[-1]) >= 4 else [0.0, 0.0, 0.0, 1.0]
            
            total_time = (timestamps[-1] - timestamps[0]) / 1000.0
            # For UV rotation, we typically care about Z component
            total_rotation_change = last_quat[2] - first_quat[2]
            
            deltas = []
            time_deltas = []
            
            for i in range(1, len(timestamps)):
                time_delta = timestamps[i] - timestamps[i-1]
                if time_delta > 0:
                    # Rotation values are quaternions [x, y, z, w], we focus on Z axis
                    value_delta = values[i][2] - values[i-1][2] if len(values[i]) > 2 else 0.0
                    
                    deltas.append(value_delta)
                    time_deltas.append(time_delta)
            
            if deltas and time_deltas and total_time > 0:
                avg_delta = sum(deltas) / len(deltas)
                avg_time_delta = sum(time_deltas) / len(time_deltas)
                calculated_rate = (avg_delta / avg_time_delta) * 1000.0
                
                min_rotation_threshold = 0.01
                if abs(total_rotation_change) > min_rotation_threshold:
                    if not result['has_animation']:
                        result['has_animation'] = True
                        result['animation_type'] = 'rotation'
                    
                    min_rotation_rate = 0.1
                    if abs(calculated_rate) > 0:
                        result['rotate_rate'] = calculated_rate
                    else:
                        result['rotate_rate'] = min_rotation_rate if total_rotation_change > 0 else -min_rotation_rate
    
    # Process scaling track
    scaling_track = transform_data.get('scaling')
    if scaling_track and scaling_track.get('timestamps') and scaling_track.get('values'):
        timestamps = scaling_track['timestamps']
        values = scaling_track['values']
        
        if len(timestamps) > 1 and len(values) > 1:
            # Get first and last values to determine overall scaling direction
            first_scale = values[0] if len(values[0]) >= 2 else [1.0, 1.0]
            last_scale = values[-1] if len(values[-1]) >= 2 else [1.0, 1.0]
            
            total_time = (timestamps[-1] - timestamps[0]) / 1000.0
            total_scale_change_x = last_scale[0] - first_scale[0]
            total_scale_change_y = last_scale[1] - first_scale[1]
            
            deltas_x = []
            deltas_y = []
            time_deltas = []
            
            for i in range(1, len(timestamps)):
                time_delta = timestamps[i] - timestamps[i-1]
                if time_delta > 0:
                    # Values are arrays of [x, y, z], we only need x and y for UV
                    value_delta_x = values[i][0] - values[i-1][0] if len(values[i]) > 0 else 0.0
                    value_delta_y = values[i][1] - values[i-1][1] if len(values[i]) > 1 else 0.0
                    
                    deltas_x.append(value_delta_x)
                    deltas_y.append(value_delta_y)
                    time_deltas.append(time_delta)
            
            if deltas_x and time_deltas and total_time > 0:
                avg_delta_x = sum(deltas_x) / len(deltas_x)
                avg_delta_y = sum(deltas_y) / len(deltas_y)
                avg_time_delta = sum(time_deltas) / len(time_deltas)
                
                calculated_rate_x = (avg_delta_x / avg_time_delta) * 1000.0
                calculated_rate_y = (avg_delta_y / avg_time_delta) * 1000.0
                
                min_scale_threshold = 0.01
                if abs(total_scale_change_x) > min_scale_threshold or abs(total_scale_change_y) > min_scale_threshold:
                    if not result['has_animation']:
                        result['has_animation'] = True
                        result['animation_type'] = 'scaling'
                    
                    min_scale_rate = 0.05
                    
                    if abs(calculated_rate_x) > 0:
                        result['scale_rate'][0] = calculated_rate_x
                    elif abs(total_scale_change_x) > min_scale_threshold:
                        result['scale_rate'][0] = min_scale_rate if total_scale_change_x > 0 else -min_scale_rate
                    
                    if abs(calculated_rate_y) > 0:
                        result['scale_rate'][1] = calculated_rate_y
                    elif abs(total_scale_change_y) > min_scale_threshold:
                        result['scale_rate'][1] = min_scale_rate if total_scale_change_y > 0 else -min_scale_rate
    
    # Log detected animations
    if result['has_animation']:
        print(f"UV Animation: {result['animation_type']} (X:{result['translate_rate'][0]:.2f}, Y:{result['translate_rate'][1]:.2f})")
    
    return result